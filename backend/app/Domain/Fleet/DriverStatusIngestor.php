<?php

namespace App\Domain\Fleet;

use App\Domain\Dispatch\Jobs\SyncTripFromWaypoints;
use App\Domain\Dispatch\LockRetry;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Support\EpochTime;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Applies a batch of live driver statuses to a tenant's roster and drives each
 * driver's in-flight offer through its lifecycle — inferred from the status
 * transitions (we observe Uber, we don't control the trip):
 *
 *   idle → EN_ROUTE      accept the pending offer      (driver → heading to pickup)
 *   → ON_TRIP            start it                       (driver → on trip)
 *   ON_TRIP → EN_ROUTE   complete + accept the next    (back-to-back: took a new trip)
 *   engaged → idle       complete (if started) or cancel (if only accepted);
 *                        reject any still-pending offer (available again, passed on it)
 *
 * Shared by the manager's extension sync and the daemon's continuous poll.
 */
class DriverStatusIngestor
{
    /** How often (seconds) the opportunistic stale-offer sweep may run per tenant. */
    private const SWEEP_THROTTLE_SECONDS = 15;

    /**
     * A "trip" that returns to idle within this many seconds of starting never
     * really began — it's an Uber status flicker (a brief ON_TRIP reported before
     * the driver's real EN_ROUTE). Completing it would finalize a freshly-accepted
     * offer as a seconds-long trip and lock out the driver's genuine engagement a
     * poll later. Below this floor we leave the offer STARTED; a later real idle —
     * or the 100-minute stale sweep — completes it correctly.
     */
    private const MIN_TRIP_SECONDS = 60;

    /**
     * An unchanged driver's status_synced_at is bumped at most this often. Well
     * below every freshness window that reads it (live map 10 min, fleet:check-sync
     * and fleet:check-offer-flow 5 min).
     */
    private const HEARTBEAT_SECONDS = 60;

    /** Waypoints kept per driver (a pickup + a handful of drop-offs is the real max). */
    public const MAX_WAYPOINTS = 12;

    /**
     * How long a daemon status batch keeps the extension from writing statuses for
     * the company. The daemon polls every 3-6 s, so a lapse this long means its
     * supplier polls stopped and the extension should take over again.
     */
    private const DAEMON_SOURCE_TTL_SECONDS = 20;

    public function __construct(
        private readonly OfferLifecycle $lifecycle,
    ) {}

    /** Record that the daemon is currently this company's status source. */
    public static function markDaemonFeeding(int $tenantId): void
    {
        Cache::put(self::daemonSourceKey($tenantId), 1, self::DAEMON_SOURCE_TTL_SECONDS);
    }

    /** Whether the daemon delivered a status batch for the company recently. */
    public static function daemonIsFeeding(int $tenantId): bool
    {
        return Cache::has(self::daemonSourceKey($tenantId));
    }

    private static function daemonSourceKey(int $tenantId): string
    {
        return "status-src:daemon:{$tenantId}";
    }

    /**
     * @param  array<int, array<string, mixed>>  $statuses
     * @return array{updated: int, accepted: int, started: int, completed: int, canceled: int, rejected: int}
     */
    public function ingest(int $tenantId, array $statuses): array
    {
        $counts = ['updated' => 0, 'accepted' => 0, 'started' => 0, 'completed' => 0, 'canceled' => 0, 'rejected' => 0, 'multistop' => 0];

        // One SELECT for the whole batch instead of one per driver: at the engaged
        // cadence (3 s) a 100-driver fleet was ~33 lookups/s from a single tenant
        // before any lifecycle work.
        $drivers = Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereIn('uber_driver_uuid', collect($statuses)->pluck('driver_uuid')->filter()->unique()->all())
            ->get()
            ->keyBy('uber_driver_uuid');

        // Drivers whose row had nothing new: their status_synced_at heartbeat is
        // bumped in ONE bulk UPDATE after the loop instead of one UPDATE each.
        $heartbeatIds = [];

        foreach ($statuses as $row) {
            $uuid = $row['driver_uuid'] ?? null;
            if (! $uuid) {
                continue;
            }

            $driver = $drivers->get($uuid);
            if ($driver === null) {
                continue;
            }

            // Two sources write statuses (the daemon every few seconds, the extension
            // once a minute) and a slow batch can land AFTER a newer one. Applying it
            // would move the driver back a step and fabricate an engagement edge (a
            // fake ON_TRIP → EN_ROUTE completes the trip and accepts the wrong offer),
            // so a row whose fix is OLDER than the stored one is dropped.
            $fixAt = EpochTime::fromMs($row['location_updated_at'] ?? null);
            if ($this->isStale($fixAt, $driver->location_updated_at)) {
                continue;
            }

            $was = Driver::engagementLevel($driver->online_status);
            $now = Driver::engagementLevel($row['status'] ?? '');
            // Was the driver OFFLINE (not merely idle) before this poll? Distinguishes a
            // genuine idle→trip start from a reconnect that resumes a trip preserved
            // across an offline blip. Read from the pre-update status.
            $wasOffline = ! Driver::statusIsOnline($driver->online_status);

            // Uber returns 0,0 for offline/idle drivers, so keep real coordinates
            // only (null otherwise) — that also drops offline drivers off the map.
            $lat = $this->coord($row['latitude'] ?? null);
            $lng = $this->coord($row['longitude'] ?? null);

            // The fleet operates in Germany; Uber occasionally returns a garbage
            // fix (a driver plotted in Ukraine/mid-ocean). Reject anything outside a
            // generous DACH box so a bad position drops the car off the map instead
            // of teleporting it across Europe until the next valid fix arrives.
            if ($lat !== null && $lng !== null && ! $this->inGermanyBox($lat, $lng)) {
                $lat = $lng = null;
            }

            // Stamp WHEN the driver first went offline (kept until they're back online)
            // so the lifecycle can tell a real sign-off from a brief mid-trip blip.
            $onlineNow = Driver::statusIsOnline($row['status'] ?? null);

            $waypoints = $lat !== null ? $this->waypoints($row['waypoints'] ?? null) : null;
            $previousWaypointCount = count(is_array($driver->trip_waypoints) ? $driver->trip_waypoints : []);

            try {
                $driver->fill([
                    'online_status' => $row['status'] ?? null,
                    'went_offline_at' => $onlineNow ? null : ($driver->went_offline_at ?? now()),
                    'location_updated_at' => $fixAt,
                    'latitude' => $lat,
                    'longitude' => $lng,
                    'heading' => $lat !== null && is_numeric($row['heading'] ?? null) ? $row['heading'] : null,
                    'trip_waypoints' => $waypoints,
                ]);

                // Only write a driver whose data actually changed. An unchanged row
                // (most offline/idle drivers, every poll) just needs its freshness
                // heartbeat, batched below — a 100-driver fleet at the 3 s cadence was
                // ~33 no-op UPDATEs a second.
                if ($driver->isDirty()) {
                    $driver->status_synced_at = now();
                    $driver->save();
                } elseif ($this->heartbeatDue($driver)) {
                    $heartbeatIds[] = $driver->id;
                }
            } catch (\Throwable $e) {
                // One malformed status row must never fail the whole batch (which
                // would 500 the endpoint and drop every driver + acceptance).
                $this->logUpdateFailure($tenantId, $driver, $e);

                continue;
            }
            $counts['updated']++;

            // The offer mutations here (accept/start/complete) update dispatch_offers
            // rows that a concurrent status poll — or the bulk stale-sweep — may hold
            // locks on, so they can deadlock (1213). Retry a couple of times, then
            // report and move on: a lost transition is re-derived on the next poll and
            // must never 500 the batch (which would drop every driver + acceptance).
            $this->retryOnDeadlock(function () use ($tenantId, $uuid, $was, $now, $onlineNow, $wasOffline, &$counts) {
                $this->applyTransition($tenantId, $uuid, $was, $now, $onlineNow, $wasOffline, $counts);
            });

            // Once engaged, Uber's live map carries the trip's real pickup/drop-off
            // (and any extra stops) as waypoints — the authoritative source for
            // fixing an ungeocodable offer and surfacing/alerting multi-stop trips.
            // The resolve is an OSRM route + reverse-geocode (multi-second, external),
            // so it runs OFF this hot path on the queue; the multi-stop push fires
            // once the geo resolves. Only for engaged drivers with waypoints, and only
            // when there is something new to resolve (see needsTripSync()).
            if ($now >= 1 && $waypoints !== null
                && $this->needsTripSync($tenantId, $uuid, $was !== $now, count($waypoints), $previousWaypointCount)) {
                rescue(function () use ($tenantId, $uuid): void {
                    SyncTripFromWaypoints::dispatch($tenantId, $uuid);
                });
            }
        }

        if ($heartbeatIds !== []) {
            Driver::withoutGlobalScopes()->whereIn('id', $heartbeatIds)->update(['status_synced_at' => now()]);
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
     * Run a DB mutation, retrying a few times on a deadlock / lock-wait timeout
     * (concurrent status polls contend on the same offer rows). On the final
     * failure it reports and returns instead of throwing, so one lost transition
     * never 500s the whole batch.
     */
    private function retryOnDeadlock(callable $fn, int $attempts = 5): void
    {
        for ($i = 1; ; $i++) {
            try {
                $fn();

                return;
            } catch (QueryException $e) {
                $lock = LockRetry::isLockError($e);
                if ($i >= $attempts || ! $lock) {
                    // A non-lock error is a real bug → Sentry. An exhausted lock
                    // retry is an expected, self-healing transient (the transition
                    // re-derives on the next poll) → log it, but don't page anyone.
                    $lock
                        ? Log::warning('driver_status.transition_deadlock_retry_exhausted', [
                            'error' => $e->getMessage(),
                            'attempts' => $attempts,
                        ])
                        : report($e);

                    return;
                }
                usleep(50_000 * $i); // brief, growing backoff before the retry
            }
        }
    }

    /**
     * Move the driver's in-flight offer based on the engagement-level edge.
     *
     * @param  array<string, int>  $counts
     */
    private function applyTransition(int $tenantId, string $uuid, int $was, int $now, bool $onlineNow, bool $wasOffline, array &$counts): void
    {
        // Every branch below needs an engagement-level EDGE, so there is nothing to
        // infer (and nothing to look up) when the level is unchanged.
        if ($was === $now) {
            return;
        }

        // Resolved ONCE here and reused below: the diagnostic used to fetch both rows
        // and the branch immediately after re-fetched exactly the same two, so every
        // real engagement edge paid for two redundant queries purely for a log line.
        $active = $this->lifecycle->activeOfferFor($tenantId, $uuid);
        $pending = $this->lifecycle->pendingOfferFor($tenantId, $uuid);

        // Diagnostic: every real engagement-level change, with the offer it resolved to.
        // Surfaces in the admin Logs tab so we can see WHY a busy driver's acceptance is
        // (not) detected — e.g. an idle→engaged edge the coarse poll missed.
        RidyLog::event('driver_status.transition', [
            'driver' => substr($uuid, 0, 8),
            'was' => $was,
            'now' => $now,
            'active_offer' => $active?->id,
            'pending_offer' => $pending?->id,
        ]);

        // idle → engaged: attribute the pending offer and accept it.
        if ($was === 0 && $now >= 1) {

            // A STARTED offer surviving here is a driver RESUMING a trip after an
            // offline blip (the engaged→idle branch preserved it), NOT a new
            // engagement — but ONLY when they were actually OFFLINE before. Leave it
            // running: attributing a pending back-to-back offer to this edge would
            // supersede (force-complete) the live trip below. A plain idle→trip start
            // with a stale STARTED offer still falls through so supersedeActiveFor
            // finalizes the stale one (a driver never shows two live trips).
            if ($wasOffline && $active !== null && $active->status === OfferStatus::Started) {
                return;
            }

            if ($pending !== null && $this->lifecycle->accept($pending)) {
                $counts['accepted']++;
                // Jumped straight to ON_TRIP (skipped EN_ROUTE) — start it too.
                if ($now === 2 && $this->lifecycle->start($pending)) {
                    $counts['started']++;
                }
                // A driver holds one active trip — finalize any older stuck offer.
                $this->lifecycle->supersedeActiveFor($tenantId, $uuid, $pending->id);
            } elseif ($now === 2 && $active !== null && $active->status === OfferStatus::Accepted && $this->lifecycle->start($active)) {
                // No fresh pending offer, but an offer ACCEPTED before a brief OFFLINE
                // blip (which we no longer cancel) may now be starting — the driver
                // reconnected straight to ON_TRIP. Start it so the trip is tracked.
                $counts['started']++;
            }

            return;
        }

        // EN_ROUTE → ON_TRIP: the accepted offer's trip has begun.
        if ($was === 1 && $now === 2) {
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
            if ($this->tripLooksReal($active) && $this->lifecycle->complete($active)) {
                $counts['completed']++;
            }
            if ($active !== null && $active->received_at !== null) {
                $next = $this->lifecycle->nextTakeableOfferAfter($tenantId, $uuid, $active->received_at);
                if ($next !== null && $this->lifecycle->accept($next)) {
                    $counts['accepted']++;
                    $this->lifecycle->supersedeActiveFor($tenantId, $uuid, $next->id);
                }
            }

            return;
        }

        // engaged → idle: the offer is done (completed if it started, else canceled).
        if ($was >= 1 && $now === 0) {
            // A NEW offer that arrived during the trip but was never taken: the driver
            // is available again and never engaged on it (didn't go EN_ROUTE) → it was
            // passed on → reject it. Only on a genuine idle-ONLINE return (an OFFLINE
            // blip is left to the offline sweep). A coarse poll that missed a real
            // back-to-back engagement is safe — the 3-min late-accept grace overturns
            // this rejection when the driver then engages on it a poll later.
            if ($onlineNow) {
                $counts['rejected'] += $this->lifecycle->rejectPendingFor($tenantId, $uuid);
            }

            if ($active === null) {
                return;
            }
            // Neither a STARTED nor an ACCEPTED (EN_ROUTE) offer is closed on an
            // OFFLINE edge — that may be a sign-off OR a brief connection blip. Both
            // are left for finalizeStale to sweep after a grace (a STARTED trip
            // completes, an ACCEPTED one cancels), so a driver whose internet drops
            // for a moment and returns keeps their trip: a mid-trip blip stays Started,
            // and an EN_ROUTE blip stays Accepted and is recovered when they go ON_TRIP
            // (idle→engaged / EN_ROUTE→ON_TRIP start). Only a genuine idle-ONLINE end
            // (the driver is available again) resolves the offer here.
            if ($active->status === OfferStatus::Started) {
                if ($onlineNow && $this->tripLooksReal($active) && $this->lifecycle->complete($active)) {
                    $counts['completed']++;
                }
            } elseif ($active->status === OfferStatus::Accepted) {
                if ($onlineNow && $this->lifecycle->cancel($active)) {
                    $counts['canceled']++;
                }
            }
            // Any OLDER stuck offer, though, is closed now (the latest is kept).
            $this->lifecycle->supersedeActiveFor($tenantId, $uuid, $active->id);
        }
    }

    /**
     * A started offer whose trip lasted long enough to be a genuine dropoff rather
     * than a status flicker — see {@see self::MIN_TRIP_SECONDS}.
     */
    private function tripLooksReal(?DispatchOffer $active): bool
    {
        return $active !== null
            && $active->status === OfferStatus::Started
            && $active->started_at !== null
            && $active->started_at->diffInSeconds(now()) >= self::MIN_TRIP_SECONDS;
    }

    /**
     * True when an incoming fix is older than the one already stored — a late batch
     * from the slower source. Null-safe (idle/offline drivers often carry no fix),
     * and a stored value in the future (clock skew) never blocks newer data.
     */
    private function isStale(?CarbonImmutable $incoming, mixed $stored): bool
    {
        if ($incoming === null || $stored === null) {
            return false;
        }

        $stored = CarbonImmutable::instance($stored);

        return $stored->lessThanOrEqualTo(now()) && $incoming->lessThan($stored);
    }

    /** Whether an unchanged driver's freshness stamp is old enough to bump. */
    private function heartbeatDue(Driver $driver): bool
    {
        return $driver->status_synced_at === null
            || $driver->status_synced_at->lessThan(now()->subSeconds(self::HEARTBEAT_SECONDS));
    }

    /**
     * The trip waypoints worth keeping: an array, capped. They drive an OSRM route
     * and a reverse geocode per stop on the queue, so an oversized list must never
     * reach the driver row.
     *
     * @return array<int, mixed>|null
     */
    private function waypoints(mixed $waypoints): ?array
    {
        if (! is_array($waypoints) || $waypoints === []) {
            return null;
        }

        return array_slice(array_values($waypoints), 0, self::MAX_WAYPOINTS);
    }

    /**
     * Whether an engaged driver's waypoints need a (queued) trip resolve: on an
     * engagement edge (a new or back-to-back trip), when the stop list changed size,
     * or when no resolve has been recorded for the current list yet. Otherwise the
     * job would run every poll for the whole trip only to no-op.
     */
    private function needsTripSync(int $tenantId, string $uuid, bool $edge, int $count, int $previousCount): bool
    {
        if ($edge || $count !== $previousCount) {
            return true;
        }

        return Cache::get(SyncTripFromWaypoints::syncedMarkerKey($tenantId, $uuid)) !== $count;
    }

    /** A per-driver update failure, logged (rate-limited per tenant) — RidyLog is off in prod. */
    private function logUpdateFailure(int $tenantId, Driver $driver, \Throwable $e): void
    {
        if (Cache::add("driver_status.update_failed:{$tenantId}", 1, 60)) {
            Log::warning('driver_status.update_failed', [
                'tenant_id' => $tenantId,
                'driver_id' => $driver->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** A usable coordinate, or null for the 0,0 Uber returns when there's no live fix. */
    private function coord(mixed $value): ?float
    {
        $n = is_numeric($value) ? (float) $value : 0.0;

        return abs($n) < 0.0001 ? null : $n;
    }

    /**
     * Whether a fix falls inside a generous Germany/DACH-and-neighbours box —
     * wide enough for border trips, tight enough to reject an obviously wrong
     * position (e.g. Uber returning coordinates in Ukraine or the ocean).
     */
    private function inGermanyBox(float $lat, float $lng): bool
    {
        return $lat >= 45.0 && $lat <= 56.0 && $lng >= 4.0 && $lng <= 17.0;
    }
}
