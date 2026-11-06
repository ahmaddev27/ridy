<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Tenancy\Models\Tenant;
use App\Jobs\SyncTenantEarnings;
use App\Jobs\SyncTenantMetrics;
use App\Jobs\SyncTenantVehicles;

/**
 * Fleet Hub data (vehicles, earnings, metrics) for ONE company right now, instead
 * of waiting for the hourly backstop. Same gates as the scheduled commands:
 * UBER_SERVER_SYNC on and the company eligible (proxy, supplier jar, new system).
 */
class FleetDataSync
{
    public function __construct(private readonly FleetHubSessionResolver $resolver) {}

    /** Queue the three per-company jobs; returns false (reason logged) when skipped. */
    public function dispatchFor(Tenant $tenant): bool
    {
        if (! config('services.uber.server_sync') || $this->resolver->eligibleTenant($tenant) === null) {
            return false;
        }

        SyncTenantVehicles::dispatch((int) $tenant->id);
        SyncTenantEarnings::dispatch((int) $tenant->id);
        SyncTenantMetrics::dispatch((int) $tenant->id);

        return true;
    }

    /**
     * Synchronous vehicles + earnings pull for the "Sync now" button.
     *
     * @return array{status: string, reason?: string, vehicles?: int, earnings?: int}
     *
     * @throws UberEarningsException
     */
    public function runNow(Tenant $tenant, VehicleSync $vehicles, EarningsSync $earnings): array
    {
        if (! config('services.uber.server_sync')) {
            return ['status' => 'skipped', 'reason' => 'server_sync_disabled'];
        }
        if ($this->resolver->eligibleTenant($tenant) === null) {
            return ['status' => 'skipped', 'reason' => $this->resolver->skipReasonFor($tenant)];
        }

        return [
            'status' => 'synced',
            'vehicles' => $vehicles->syncTenant($tenant),
            'earnings' => $earnings->syncTenant($tenant),
        ];
    }
}
