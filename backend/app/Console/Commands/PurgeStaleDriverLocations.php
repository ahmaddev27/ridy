<?php

namespace App\Console\Commands;

use App\Domain\Fleet\Models\Driver;
use Illuminate\Console\Command;

/**
 * "Location only during active trips": once a driver's status stops syncing (the
 * session broke, the extension closed, the driver left the roster mid-trip) their
 * last position and the trip's waypoints would otherwise stay on the row — and in
 * every backup — indefinitely. Clears them after the same staleness window that
 * already hides the driver from the live map. Status fields are left alone: the
 * offline-grace lifecycle relies on them.
 */
class PurgeStaleDriverLocations extends Command
{
    protected $signature = 'fleet:purge-stale-locations';

    protected $description = 'Clear the last position + trip waypoints of drivers whose status stopped syncing.';

    public function handle(): int
    {
        $cleared = Driver::withoutGlobalScopes()
            ->where(fn ($q) => $q->whereNotNull('latitude')->orWhereNotNull('trip_waypoints'))
            ->where(fn ($q) => $q->whereNull('status_synced_at')
                ->orWhere('status_synced_at', '<', now()->subMinutes(Driver::LIVE_STALE_MINUTES)))
            ->update(['latitude' => null, 'longitude' => null, 'heading' => null, 'trip_waypoints' => null]);

        $this->info("Cleared {$cleared} stale driver location(s).");

        return self::SUCCESS;
    }
}
