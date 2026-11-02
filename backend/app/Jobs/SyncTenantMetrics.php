<?php

namespace App\Jobs;

use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\FleetHub\EarnerMetricsSync;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Pulls ONE company's per-driver GetEarnerMetrics (see EarnerMetricsSync).
 * Same contract as SyncTenantEarnings: no retries, never throws; a rejected
 * session stops the run and the next schedule tick is the retry.
 */
class SyncTenantMetrics implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    /** Below the database queue's retry_after (90 s); EarnerMetricsSync stops starting calls at 60 s. */
    public int $timeout = 80;

    public function __construct(private readonly int $tenantId) {}

    public function handle(EarnerMetricsSync $sync): void
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
            Log::info('fleethub.metrics_synced', ['tenant' => $tenant->id, 'drivers' => $count]);
        } catch (UberEarningsException $e) {
            Log::warning('fleethub.metrics_failed', ['tenant' => $tenant->id, 'reason' => $e->reason]);
        } catch (Throwable $e) {
            Log::error('fleethub.metrics_error', ['tenant' => $tenant->id, 'error' => $e::class.': '.$e->getMessage()]);
        }
    }
}
