<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;

/**
 * Resolves an engaged driver's active-offer trip from Uber's live-map waypoints —
 * an OSRM route + reverse-geocode — OFF the status-ingest hot path. Doing this
 * inline made every status poll block on multi-second external geo calls; the poll
 * now just enqueues this, and the multi-stop detection + driver push fire once the
 * geo resolves (unchanged behaviour, only asynchronous).
 *
 * Unique per driver so the fast per-poll enqueues collapse into a single in-flight
 * job (no queue churn), and it reads the driver's CURRENT waypoints at run time
 * rather than a stale snapshot — so the trip it resolves and the offer it attaches
 * to stay consistent even if the driver started a back-to-back trip between the
 * enqueue and the execution.
 */
class SyncTripFromWaypoints implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /** Transient OSRM/Nominatim failures self-heal on the next poll's enqueue. */
    public int $tries = 2;

    public int $backoff = 15;

    /** Hard stop below the worker's 60 s timeout (OSRM 8 s + a few reverse geocodes). */
    public int $timeout = 45;

    /**
     * Dedup window. Above the job's worst-case run time, so a slow OSRM/Nominatim
     * run can't let a second copy start beside it (both would send the multi-stop
     * push). Laravel releases the lock as soon as the job finishes, so a longer
     * window never holds back a later legitimate run.
     */
    public int $uniqueFor = 60;

    /** How long a resolved waypoint list stays marked as done (see syncedMarkerKey()). */
    private const SYNCED_MARKER_SECONDS = 600;

    public function __construct(
        private readonly int $tenantId,
        private readonly string $driverUuid,
    ) {}

    public function uniqueId(): string
    {
        return "sync-waypoints:{$this->tenantId}:{$this->driverUuid}";
    }

    /**
     * Cache key holding the waypoint COUNT last resolved for a driver. The status
     * ingest skips enqueueing this job while the count is unchanged and no
     * engagement edge happened — the job would only no-op.
     */
    public static function syncedMarkerKey(int $tenantId, string $driverUuid): string
    {
        return "waypoints-synced:{$tenantId}:{$driverUuid}";
    }

    public function handle(OfferLifecycle $lifecycle, TripGeocoder $geocoder, DispatchNotifier $notifier): void
    {
        // Belt and braces with the unique lock: never two resolves for one driver
        // at once. A skipped run is harmless — the next poll re-enqueues.
        Cache::lock("sync-waypoints-run:{$this->tenantId}:{$this->driverUuid}", $this->timeout + 15)
            ->get(fn () => $this->resolve($lifecycle, $geocoder, $notifier));
    }

    private function resolve(OfferLifecycle $lifecycle, TripGeocoder $geocoder, DispatchNotifier $notifier): void
    {
        // Current waypoints, read now (not snapshotted at enqueue): pairs the LATEST
        // trip geometry with the LATEST active offer, so a back-to-back trip change
        // can't apply the previous trip's points to the new offer.
        $driver = Driver::withoutGlobalScopes()
            ->where('tenant_id', $this->tenantId)
            ->where('uber_driver_uuid', $this->driverUuid)
            ->first(['id', 'trip_waypoints']);

        $waypoints = is_array($driver?->trip_waypoints) ? $driver->trip_waypoints : [];
        if ($waypoints === []) {
            return; // driver went idle / no live trip — nothing to resolve
        }

        $offer = $lifecycle->activeOfferFor($this->tenantId, $this->driverUuid);
        if ($offer === null) {
            return;
        }

        $stops = $geocoder->applyFromWaypoints($offer, $waypoints);

        // This list is resolved (or needed nothing): the ingest stops re-enqueueing
        // until the stop count changes or a new engagement edge arrives.
        Cache::put(self::syncedMarkerKey($this->tenantId, $this->driverUuid), count($waypoints), self::SYNCED_MARKER_SECONDS);

        // Non-null only when it actually updated (first resolve, or the stop count
        // changed). Alert only when it's a genuine multi-stop trip.
        if ($stops !== null && $stops >= 2) {
            rescue(fn () => $notifier->notifyMultiStop($offer, $stops), report: false);
        }
    }
}
