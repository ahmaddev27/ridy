<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Force the drivers of a lapsed company OFFLINE.
 *
 * When a company's subscription ends, the daemon stops streaming it (its session
 * is filtered out) and the browser extension is blocked (EnsureFleetConnected →
 * 403), so no fresh status ever arrives — but the last-known `online_status` stays
 * frozen, so the admin fleet list, its online stat and the map keep showing the
 * driver as live. This nulls that stale status (and location) so a lapsed
 * company's drivers read as offline EVERYWHERE, and sort to the bottom of the
 * online-first list. Self-heals: the daemon re-sets the real status the moment the
 * company reactivates.
 */
class OfflineLapsedDrivers extends Command
{
    protected $signature = 'fleet:offline-lapsed';

    protected $description = 'Mark drivers of lapsed (inactive-subscription) companies offline';

    public function handle(): int
    {
        $usableTenantIds = Tenant::query()->usable()->pluck('id')->all();

        // Only drivers currently shown as ONLINE whose company is NOT usable — so
        // this is idempotent (a second run matches nothing) and never touches an
        // active company's live status.
        $affected = Driver::withoutGlobalScopes()
            ->online()
            ->whereNotIn('tenant_id', $usableTenantIds)
            ->update([
                // Starts the offline grace, so a STARTED trip of a lapsed driver is
                // finalized by offers:finalize-stale instead of waiting for the
                // 100-minute cap (NULL < cutoff never matched). PHP time, not SQL
                // NOW(), to match the Carbon cutoff finalizeStale compares against.
                'went_offline_at' => now(),
                'online_status' => null,
                'latitude' => null,
                'longitude' => null,
                'heading' => null,
                'trip_waypoints' => null,
            ]);

        $this->info("Set {$affected} driver(s) of lapsed companies offline.");

        return self::SUCCESS;
    }
}
