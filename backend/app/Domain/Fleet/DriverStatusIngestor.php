<?php

namespace App\Domain\Fleet;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonImmutable;

/**
 * Applies a batch of live driver statuses to a tenant's roster and, when a driver
 * transitions to ON_TRIP, marks the offer they just took as accepted. Shared by
 * the manager's extension sync and the daemon's continuous poll, so both paths
 * behave identically.
 */
class DriverStatusIngestor
{
    /** Offers older than this when the trip starts aren't attributed to it. */
    private const ATTRIBUTION_MINUTES = 10;

    /**
     * @param  array<int, array{driver_uuid: string, status?: ?string, location_updated_at?: ?int}>  $statuses
     * @return array{updated: int, accepted: int}
     */
    public function ingest(int $tenantId, array $statuses): array
    {
        $updated = 0;
        $accepted = 0;

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

            // A driver is "engaged" the moment they accept an offer: EN_ROUTE (on
            // the way to the rider) comes BEFORE ON_TRIP (rider aboard). Treating
            // both as engaged catches the acceptance at the earliest signal and
            // never misses a short trip that flips through EN_ROUTE quickly.
            $wasEngaged = $this->isEngaged($driver->online_status);
            $isEngaged = $this->isEngaged($row['status'] ?? '');

            // Uber returns 0,0 for offline/idle drivers, so keep real coordinates
            // only (null otherwise) — that also drops offline drivers off the map.
            $lat = $this->coord($row['latitude'] ?? null);
            $lng = $this->coord($row['longitude'] ?? null);

            $driver->update([
                'online_status' => $row['status'] ?? null,
                'location_updated_at' => ! empty($row['location_updated_at'])
                    ? CarbonImmutable::createFromTimestampMs($row['location_updated_at']) : null,
                'status_synced_at' => now(),
                'latitude' => $lat,
                'longitude' => $lng,
                'heading' => $lat !== null ? ($row['heading'] ?? null) : null,
                'trip_waypoints' => $lat !== null && ! empty($row['waypoints']) ? $row['waypoints'] : null,
            ]);
            $updated++;

            if ($isEngaged && ! $wasEngaged) {
                $accepted += $this->markLastOfferAccepted($tenantId, $uuid);
            }
        }

        return ['updated' => $updated, 'accepted' => $accepted];
    }

    /** A usable coordinate, or null for the 0,0 Uber returns when there's no live fix. */
    private function coord(mixed $value): ?float
    {
        $n = is_numeric($value) ? (float) $value : 0.0;

        return abs($n) < 0.0001 ? null : $n;
    }

    /** True when the driver has accepted a job — heading to the rider or on the trip. */
    private function isEngaged(?string $status): bool
    {
        $s = strtoupper((string) $status);

        return str_contains($s, 'ON_TRIP') || str_contains($s, 'EN_ROUTE');
    }

    private function markLastOfferAccepted(int $tenantId, string $driverUuid): int
    {
        $offer = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->whereNull('accepted_at')
            ->where('received_at', '>=', now()->subMinutes(self::ATTRIBUTION_MINUTES))
            ->latest('received_at')
            ->first();

        if ($offer === null) {
            return 0;
        }

        $offer->update(['accepted_at' => now()]);

        return 1;
    }
}
