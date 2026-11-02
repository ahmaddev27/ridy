<?php

namespace App\Jobs;

use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\FleetHub\VehicleSync;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Pulls ONE company's vehicles from Fleet Hub (see VehicleSync). Same contract
 * as {@see SyncTenantEarnings}: isolated per company, never retries, never throws.
 */
class SyncTenantVehicles implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    /** Below the database queue's retry_after (90 s) so a run is never picked up twice. */
    public int $timeout = 80;

    public function __construct(private readonly int $tenantId) {}

    public function handle(VehicleSync $sync): void
    {
        if (! config('services.uber.server_sync')) {
            return;
        }

        $tenant = Tenant::find($this->tenantId);
        if ($tenant === null || $tenant->stateReason() !== null) {
            return;
        }

        try {
            $count = $sync->syncTenant($tenant);
            Log::info('fleethub.vehicles_synced', ['tenant' => $tenant->id, 'vehicles' => $count]);
        } catch (UberEarningsException $e) {
            Log::warning('fleethub.vehicles_failed', ['tenant' => $tenant->id, 'reason' => $e->reason]);
        } catch (Throwable $e) {
            Log::error('fleethub.vehicles_error', ['tenant' => $tenant->id, 'error' => $e::class.': '.$e->getMessage()]);
        }
    }
}
