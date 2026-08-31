<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

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

    /** Dedup window — long enough to swallow the fast (4s) engaged-poll enqueues. */
    public int $uniqueFor = 8;

    public function __construct(
        private readonly int $tenantId,
        private readonly string $driverUuid,
    ) {}

    public function uniqueId(): string
    {
        return "sync-waypoints:{$this->tenantId}:{$this->driverUuid}";
    }

    public function handle(OfferLifecycle $lifecycle, TripGeocoder $geocoder, DispatchNotifier $notifier): void
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
        // Non-null only when it actually updated (first resolve, or the stop count
        // changed). Alert only when it's a genuine multi-stop trip.
        if ($stops !== null && $stops >= 2) {
            rescue(fn () => $notifier->notifyMultiStop($offer, $stops), report: false);
        }
    }
}
