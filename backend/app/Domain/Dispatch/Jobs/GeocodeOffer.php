<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Geocodes an offer's pickup/dropoff (distance + route) off the ingest hot path.
 * The offer is already stored and the driver already notified — this only fills
 * the dashboard's trip detail, so it runs async on the queue instead of holding
 * the daemon's ingest request open on a slow external geocode. The 5-minute
 * backfill sweep is the safety net if the job fails or the queue is down.
 */
class GeocodeOffer implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /** Retry a couple times (transient Nominatim/OSRM failures), then give up. */
    public int $tries = 3;

    public int $backoff = 15;

    /** Hard stop below the worker's 60 s timeout (a few 6 s Nominatim/OSRM calls). */
    public int $timeout = 45;

    /**
     * One in-flight geocode per offer: every manager tab that opens a cold offer
     * used to queue its own copy, re-hitting Nominatim and burning the offer's
     * attempt budget.
     */
    public int $uniqueFor = 300;

    public function __construct(private readonly int $offerId) {}

    public function uniqueId(): string
    {
        return (string) $this->offerId;
    }

    public function handle(TripGeocoder $geocoder): void
    {
        // Re-fetch without the tenant scope: the queue worker has no tenant
        // context, and enrich() only reads/writes this one row + the shared
        // geocode_cache. A deleted offer (company wiped) just no-ops.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);
        if ($offer === null || $offer->geo_synced_at !== null) {
            return;
        }

        // This fills the row; it NEVER notifies. On a company that declines from
        // the dispatch panel the driver gets exactly ONE push — the bare, instant
        // one that raises the decline pop-up — and the metrics reach the phone
        // through the existing OfferBroadcast('status'), i.e. only where the
        // driver went looking for them. A second push was built here and removed
        // on 13.10.2026 by the owner's decision: a ride they did not decline is
        // already theirs and already in the app, so ringing again to recite its
        // price interrupts a driver who has nothing left to decide.
        // DO NOT REINTRODUCE a follow-up push on this path.
        $geocoder->enrich($offer);
    }
}
