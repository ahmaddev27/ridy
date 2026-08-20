<?php

namespace App\Domain\Fleet;

use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;

/**
 * Applies a batch of live driver statuses to a tenant's roster and drives each
 * driver's in-flight offer through its lifecycle — inferred from the status
 * transitions (we observe Uber, we don't control the trip):
 *
 *   idle → EN_ROUTE      accept the pending offer      (driver → heading to pickup)
 *   → ON_TRIP            start it                       (driver → on trip)
 *   engaged → idle       complete (if started) or cancel (if only accepted)
 *
 * Shared by the manager's extension sync and the daemon's continuous poll.
 */
class DriverStatusIngestor
{
    /** How often (seconds) the opportunistic stale-offer sweep may run per tenant. */
    private const SWEEP_THROTTLE_SECONDS = 15;

    public function __construct(private readonly OfferLifecycle $lifecycle) {}

    /**
     * @param  array<int, array<string, mixed>>  $statuses
     * @return array{updated: int, accepted: int, started: int, completed: int, canceled: int}
     */
    public function ingest(int $tenantId, array $statuses): array
    {
        $counts = ['updated' => 0, 'accepted' => 0, 'started' => 0, 'completed' => 0, 'canceled' => 0];

        foreach ($statuses as $row) {
            $uuid = $row['driver_uuid'] ?? null;
            if (! $uuid) {
                continue;
            }

            $driver = Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('uber_driver_uuid', $uuid)
                ->first();
            if ($driver === null) {
                continue;
            }

            $was = $this->level($driver->online_status);
            $now = $this->level($row['status'] ?? '');

            // Uber returns 0,0 for offline/idle drivers, so keep real coordinates
            // only (null otherwise) — that also drops offline drivers off the map.
            $lat = $this->coord($row['latitude'] ?? null);
            $lng = $this->coord($row['longitude'] ?? null);

            try {
                $driver->update([
                    'online_status' => $row['status'] ?? null,
                    'location_updated_at' => $this->timestampMs($row['location_updated_at'] ?? null),
                    'status_synced_at' => now(),
                    'latitude' => $lat,
                    'longitude' => $lng,
                    'heading' => $lat !== null ? ($row['heading'] ?? null) : null,
                    'trip_waypoints' => $lat !== null && ! empty($row['waypoints']) ? $row['waypoints'] : null,
                ]);
            } catch (\Throwable $e) {
                // One malformed status row must never fail the whole batch (which
                // would 500 the endpoint and drop every driver + acceptance).
                continue;
            }
            $counts['updated']++;

            $this->applyTransition($tenantId, $uuid, $was, $now, $counts);
        }

        $this->sweepStaleOffers($tenantId);

        return $counts;
    }

    /**
     * Opportunistically expire pending offers and finalize anything that slipped
     * past an unobserved edge. These are bulk UPDATEs over the tenant's offers, so
     * running them on EVERY poll made concurrent polls deadlock on the same rows.
     * Throttle to once per tenant per window (the scheduled command is the real
     * guarantee), and swallow a transient deadlock so the ingest never 500s.
     */
    private function sweepStaleOffers(int $tenantId): void
    {
        // Cache::add is atomic: only the first poll within the window runs the sweep.
        if (! Cache::add("offer-sweep:{$tenantId}", 1, self::SWEEP_THROTTLE_SECONDS)) {
            return;
        }

        try {
            $this->lifecycle->expirePending($tenantId);
            $this->lifecycle->finalizeStale($tenantId);
        } catch (QueryException $e) {
            // A best-effort safety net: a lost race here is picked up by the next
            // window or the scheduled offers:finalize-stale run. Report, don't fail.
            report($e);
        }
    }

    /**
     * Move the driver's in-flight offer based on the engagement-level edge.
     *
     * @param  array<string, int>  $counts
     */
    private function applyTransition(int $tenantId, string $uuid, int $was, int $now, array &$counts): void
    {
        // idle → engaged: attribute the pending offer and accept it.
        if ($was === 0 && $now >= 1) {
            $pending = $this->lifecycle->pendingOfferFor($tenantId, $uuid);
            if ($pending !== null && $this->lifecycle->accept($pending)) {
                $counts['accepted']++;
                // Jumped straight to ON_TRIP (skipped EN_ROUTE) — start it too.
                if ($now === 2 && $this->lifecycle->start($pending)) {
                    $counts['started']++;
                }
            }

            return;
        }

        // EN_ROUTE → ON_TRIP: the accepted offer's trip has begun.
        if ($was === 1 && $now === 2) {
            $active = $this->lifecycle->activeOfferFor($tenantId, $uuid);
            if ($active !== null && $this->lifecycle->start($active)) {
                $counts['started']++;
            }

            return;
        }

        // ON_TRIP → EN_ROUTE: back-to-back — the driver finished the current trip
        // and is heading to the next pickup. Complete the current started offer,
        // then accept the next offer that arrived DURING this trip (Uber only sends
        // it once the driver is already on a trip). Not started yet — it's EN_ROUTE.
        if ($was === 2 && $now === 1) {
            $active = $this->lifecycle->activeOfferFor($tenantId, $uuid);
            if ($active !== null && $active->status === OfferStatus::Started && $this->lifecycle->complete($active)) {
                $counts['completed']++;
            }
            if ($active !== null && $active->received_at !== null) {
                $next = $this->lifecycle->nextTakeableOfferAfter($tenantId, $uuid, $active->received_at);
                if ($next !== null && $this->lifecycle->accept($next)) {
                    $counts['accepted']++;
                }
            }

            return;
        }

        // engaged → idle: the offer is done (completed if it started, else canceled).
        if ($was >= 1 && $now === 0) {
            $active = $this->lifecycle->activeOfferFor($tenantId, $uuid);
            if ($active === null) {
                return;
            }
            if ($active->status === OfferStatus::Started && $this->lifecycle->complete($active)) {
                $counts['completed']++;
            } elseif ($active->status === OfferStatus::Accepted && $this->lifecycle->cancel($active)) {
                $counts['canceled']++;
            }
        }
    }

    /** Engagement level of a raw Uber status: 2 = on trip, 1 = heading to pickup, 0 = idle. */
    private function level(?string $status): int
    {
        $s = strtoupper((string) $status);
        if (str_contains($s, 'ON_TRIP')) {
            return 2;
        }
        if (str_contains($s, 'EN_ROUTE')) {
            return 1;
        }

        return 0;
    }

    /**
     * A millisecond timestamp as a datetime, or null. Offline drivers sometimes
     * carry 0 / garbage values that parse to year 0001, which MySQL datetime
     * rejects — those are treated as "no fix" (null).
     */
    private function timestampMs(mixed $value): ?CarbonImmutable
    {
        if (empty($value) || ! is_numeric($value) || (int) $value <= 0) {
            return null;
        }

        $ts = CarbonImmutable::createFromTimestampMs((int) $value);

        return $ts->year >= 2000 ? $ts : null;
    }

    /** A usable coordinate, or null for the 0,0 Uber returns when there's no live fix. */
    private function coord(mixed $value): ?float
    {
        $n = is_numeric($value) ? (float) $value : 0.0;

        return abs($n) < 0.0001 ? null : $n;
    }
}
