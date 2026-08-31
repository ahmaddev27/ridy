<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Resolves an engaged driver's active-offer trip from Uber's live-map waypoints —
 * an OSRM route + reverse-geocode — OFF the status-ingest hot path. Doing this
 * inline made every status poll block on multi-second external geo calls; the poll
 * now just enqueues this, and the multi-stop detection + driver push fire once the
 * geo resolves (unchanged behaviour, only asynchronous).
 */
class SyncTripFromWaypoints implements ShouldQueue
{
    use Queueable;

    /** Transient OSRM/Nominatim failures self-heal on the next poll's enqueue. */
    public int $tries = 2;

    public int $backoff = 15;

    /**
     * @param  array<int, array<string, mixed>>  $waypoints
     */
    public function __construct(
        private readonly int $tenantId,
        private readonly string $driverUuid,
        private readonly array $waypoints,
    ) {}

    public function handle(OfferLifecycle $lifecycle, TripGeocoder $geocoder, DispatchNotifier $notifier): void
    {
        $offer = $lifecycle->activeOfferFor($this->tenantId, $this->driverUuid);
        if ($offer === null) {
            return;
        }

        $stops = $geocoder->applyFromWaypoints($offer, $this->waypoints);
        // Non-null only when it actually updated (first resolve, or the stop count
        // changed). Alert only when it's a genuine multi-stop trip.
        if ($stops !== null && $stops >= 2) {
            rescue(fn () => $notifier->notifyMultiStop($offer, $stops), report: false);
        }
    }
}
