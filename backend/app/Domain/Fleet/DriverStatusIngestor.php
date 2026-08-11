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

            $wasOnTrip = str_contains(strtoupper((string) $driver->online_status), 'ON_TRIP');
            $isOnTrip = str_contains(strtoupper((string) ($row['status'] ?? '')), 'ON_TRIP');

            $driver->update([
                'online_status' => $row['status'] ?? null,
                'location_updated_at' => ! empty($row['location_updated_at'])
                    ? CarbonImmutable::createFromTimestampMs($row['location_updated_at']) : null,
                'status_synced_at' => now(),
            ]);
            $updated++;

            if ($isOnTrip && ! $wasOnTrip) {
                $accepted += $this->markLastOfferAccepted($tenantId, $uuid);
            }
        }

        return ['updated' => $updated, 'accepted' => $accepted];
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
