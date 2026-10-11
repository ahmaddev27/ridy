<?php

namespace App\Domain\Notifications\Jobs;

use App\Domain\Dispatch\DispatchCommandStatus;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The SECOND push for an offer on a company that declines from the dispatch panel:
 * the one that carries the distance, the €/km and the €-quality badge.
 *
 * Why there are two at all. The first push is deliberately bare and instant — no
 * geocoding, by the owner's decision — because its only job is to put the decline
 * pop-up on screen while the offer is still open. This one is the opposite: it
 * arrives once the decision has passed, says "this ride is yours, here is what it
 * is worth", and it is the push that carries the "Open in map" action — a button
 * that means nothing on an offer nobody has taken yet.
 *
 * It is NOT sent when the driver declined. That is the whole point: a decline means
 * the ride never became theirs, and following it with its distance and price would
 * be the app arguing with a decision the driver just made.
 *
 * DELAYED rather than sent the moment geocoding finishes. The queue worker runs
 * with `--sleep=2`, so enrichment typically completes a second or two into Uber's
 * ~5-second window — i.e. while the driver is still holding the pop-up deciding.
 * Landing "here are your trip details" mid-decision is worse than landing it a few
 * seconds later, so it waits for the window to close.
 *
 * Together with the guard below that makes the ordering safe either way: the delay
 * means the decline has normally already resolved, and the guard catches it when it
 * has not.
 */
class SendEnrichedOfferPush implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /** A transient FCM failure is worth one retry; past that the trip is underway. */
    public int $tries = 2;

    public int $backoff = 5;

    /**
     * Past this age the follow-up is dropped. After a worker outage or a
     * "retry all" on failed jobs it would otherwise push trip details for rides
     * that finished hours ago.
     */
    public const MAX_AGE_SECONDS = 300;

    /** Grace after the offer's own window before the details may land. */
    public const DECISION_GRACE_SECONDS = 3;

    public const QUEUE = 'push';

    /** One follow-up per offer, however many geocode passes ran. */
    public int $uniqueFor = 600;

    public function __construct(private readonly int $offerId)
    {
        $this->onQueue(self::QUEUE);
    }

    public function uniqueId(): string
    {
        return (string) $this->offerId;
    }

    public function handle(DispatchNotifier $notifier): void
    {
        // No tenant context on the worker; this reads and pushes one row.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);

        if ($offer === null || $offer->driver_id === null) {
            return;
        }

        if ($offer->received_at !== null && $offer->received_at->diffInSeconds(now()) > self::MAX_AGE_SECONDS) {
            return;
        }

        // The company's switch may have closed while this sat in the queue.
        if ($offer->tenant?->dispatchRejectEnabled() !== true) {
            return;
        }

        if (! $this->offerSurvived($offer)) {
            return;
        }

        // Nothing to add: the geocode found nothing usable, so this push would
        // repeat the bare one and buy the driver a second chime for no information.
        if ($offer->distance_m === null) {
            return;
        }

        try {
            $notifier->notify($offer);
        } catch (\Throwable $e) {
            Log::warning('dispatch_offer.enriched_push_failed', [
                'offer_id' => $offer->id,
                'error' => $e->getMessage(),
            ]);

            throw $e; // let the queue retry it once
        }
    }

    /**
     * Whether the offer is still the driver's to be told about.
     *
     * Two ways it is not: a decline Uber already confirmed (`dispatch_rejected_at`),
     * or a decline still in flight — the driver tapped, the row is queued or claimed,
     * and Uber has not answered yet. The second case is the race this delay exists
     * to avoid and the guard exists to close: pushing trip details between the tap
     * and the verdict would tell the driver they got a ride they just declined.
     *
     * A FAILED or EXPIRED command does not block it: Uber refused the decline or
     * nobody delivered it, so the ride really is the driver's and the details are
     * exactly what they now need.
     */
    private function offerSurvived(DispatchOffer $offer): bool
    {
        if ($offer->dispatch_rejected_at !== null) {
            return false;
        }

        return ! OfferDispatchCommand::withoutGlobalScopes()
            ->where('dispatch_offer_id', $offer->id)
            ->whereIn('status', [DispatchCommandStatus::Queued, DispatchCommandStatus::Claimed])
            ->exists();
    }
}
