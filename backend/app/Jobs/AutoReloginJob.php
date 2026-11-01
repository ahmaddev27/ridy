<?php

namespace App\Jobs;

use App\Domain\Dispatch\AutoReloginService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Starts an automatic passwordless Uber login for a company whose session needs re-auth
 * (docs/27, variant B). The payload is the tenant id ONLY - no email, no code: the job
 * re-reads the settings when it runs, and the code arrives later by email, straight into
 * the inbound handler, never through the queue.
 *
 * One try: a failed or timed-out login goes back to needs_otp on its own (uber-auth) and
 * the manager's own start (variant A) is the fallback. Retrying here would burn the daily cap.
 */
class AutoReloginJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    /** start() can wait ~90 s on uber-auth. */
    public int $timeout = 120;

    public function __construct(public readonly int $tenantId) {}

    public function handle(AutoReloginService $service): void
    {
        $service->run($this->tenantId);
    }
}
