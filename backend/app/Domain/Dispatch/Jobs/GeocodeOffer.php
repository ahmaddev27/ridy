<?php

namespace App\Domain\Dispatch\Jobs;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Notifications\Jobs\SendEnrichedOfferPush;
use Carbon\CarbonImmutable;
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

        $geocoder->enrich($offer);

        // On a company that declines from the dispatch panel, the driver's FIRST
        // push was deliberately bare — no geocoding, so it could go out while the
        // offer was still open. Now that the metrics exist, follow up with them,
        // but only once the decision window has passed and only if the offer was
        // not declined. SendEnrichedOfferPush owns both of those rules.
        if ($offer->tenant?->dispatchRejectEnabled() !== true) {
            return;
        }

        rescue(function () use ($offer): void {
            SendEnrichedOfferPush::dispatch($offer->id)->delay($this->detailsDueAt($offer));
        });
    }

    /**
     * When the trip details may land: after the offer's own window plus a grace.
     *
     * Measured from Uber's clock (`offer_generated_at`) where it sent one, so the
     * wait reflects the offer's real remaining window rather than our ingest
     * latency. Never negative — a geocode that finished late sends immediately.
     */
    private function detailsDueAt(DispatchOffer $offer): CarbonImmutable
    {
        $base = $offer->offer_generated_at ?? $offer->received_at ?? CarbonImmutable::now();
        $window = max((int) ($offer->accept_window_seconds ?? 0), 5);
        $due = CarbonImmutable::parse($base)
            ->addSeconds($window + SendEnrichedOfferPush::DECISION_GRACE_SECONDS);

        return $due->isPast() ? CarbonImmutable::now() : $due;
    }
}
