<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Detect a SILENTLY broken Uber connection: an active company that has linked drivers
 * but whose live driver-status sync has gone stale — i.e. the extension's status poll
 * stopped delivering. This is exactly the failure Uber's supplier.uber.com →
 * fleethub.uber.com migration caused (offers kept flowing but statuses died, so every
 * offer read "Not taken" and the live map emptied), which nothing surfaced until it was
 * noticed by hand. Logging it (visible on the admin Logs tab) makes the next such break
 * — a portal move, a killed extension, a rotated session — obvious immediately.
 */
class CheckFleetSync extends Command
{
    protected $signature = 'fleet:check-sync';

    protected $description = 'Log companies whose Uber driver-status sync has gone stale.';

    /** No fresh status from ANY of a company's drivers within this window = stale. */
    private const STALE_MINUTES = 12;

    public function handle(): int
    {
        $fresh = now()->subMinutes(self::STALE_MINUTES);
        $stale = 0;

        foreach (Tenant::query()->get() as $tenant) {
            // Only companies we actually serve — a stopped/expired one is moot.
            if ($tenant->stateReason() !== null) {
                continue;
            }

            $base = Driver::withoutGlobalScopes()->where('tenant_id', $tenant->id);
            $linked = (clone $base)->whereNotNull('uber_driver_uuid')->count();
            if ($linked === 0) {
                continue; // not connected / no roster synced yet
            }

            $freshCount = (clone $base)->where('status_synced_at', '>=', $fresh)->count();
            if ($freshCount > 0) {
                continue; // sync is live
            }

            $stale++;
            // max() returns the raw column string, not a Carbon — log it as-is (the
            // old optional(...)->__toString() always yielded null).
            $last = (clone $base)->max('status_synced_at');
            Log::warning('fleet.sync_stale', [
                'tenant' => $tenant->id,
                'company' => $tenant->name,
                'linked_drivers' => $linked,
                'last_status_sync' => $last,
                'stale_for_minutes' => $last !== null
                    ? max(0, (int) ((time() - CarbonImmutable::parse($last)->getTimestamp()) / 60))
                    : null,
            ]);
        }

        $this->info("Checked fleet sync — {$stale} company(ies) stale.");

        return self::SUCCESS;
    }
}
