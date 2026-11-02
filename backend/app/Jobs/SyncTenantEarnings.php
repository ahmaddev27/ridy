<?php

namespace App\Jobs;

use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\FleetHub\EarningsSync;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Pulls ONE company's current-week earnings from Fleet Hub (see EarningsSync).
 *
 * One job per company so a slow proxy cannot hold up the others. It never
 * retries and never throws: a rejected session is the relink flow's business,
 * and the next scheduled run is the retry. A failure is logged and swallowed.
 */
class SyncTenantEarnings implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;

    /** Below the database queue's retry_after (90 s) so a run is never picked up twice. */
    public int $timeout = 80;

    public function __construct(private readonly int $tenantId) {}

    public function handle(EarningsSync $sync): void
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
            Log::info('fleethub.earnings_synced', ['tenant' => $tenant->id, 'drivers' => $count]);
        } catch (UberEarningsException $e) {
            Log::warning('fleethub.earnings_failed', ['tenant' => $tenant->id, 'reason' => $e->reason]);
        } catch (Throwable $e) {
            Log::error('fleethub.earnings_error', ['tenant' => $tenant->id, 'error' => $e::class.': '.$e->getMessage()]);
        }
    }
}
