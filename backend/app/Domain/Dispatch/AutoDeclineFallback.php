<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Jobs\GeocodeOffer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The safety net under auto-decline (docs/25). The engine suppresses the push the
 * moment a decline is QUEUED; if that decline then ultimately fails (Uber refused,
 * no verdict) or expires unsent, the driver would hold an un-declined AND
 * un-notified offer — a silent failure. This sends the push belatedly so they can
 * decide by hand, exactly as they would have without the feature.
 */
class AutoDeclineFallback
{
    public function __construct(private DispatchNotifier $notifier) {}

    /**
     * Push the offer to its driver if it was auto-declined, is still pending and the
     * decline never landed. Idempotent: the atomic claim on auto_decline_failed_at
     * lets exactly one caller send. Returns whether a push was sent.
     */
    public function recover(DispatchOffer $offer): bool
    {
        if (! $this->eligible($offer) || ! $this->claim($offer)) {
            return false;
        }

        Log::warning('dispatch_offer.auto_decline_failed_belated_push', [
            'offer_id' => $offer->id,
            'driver_id' => $offer->driver_id,
            'reason' => $offer->auto_decline_reason,
        ]);

        try {
            // The same bare pop-up push the tenant's normal path sends: the offer is
            // open again for a manual decision.
            $this->notifier->notify($offer, fast: true);
        } catch (Throwable $e) {
            report($e);

            return false;
        }

        if ($offer->geo_synced_at === null) {
            rescue(function () use ($offer): void {
                GeocodeOffer::dispatch($offer->id);
            });
        }

        return true;
    }

    private function eligible(DispatchOffer $offer): bool
    {
        return $offer->auto_decline_reason !== null
            && $offer->auto_decline_failed_at === null
            && $offer->dispatch_rejected_at === null
            && $offer->displayStatus() === OfferStatus::Pending;
    }

    private function claim(DispatchOffer $offer): bool
    {
        $won = DispatchOffer::withoutGlobalScopes()
            ->whereKey($offer->id)
            ->whereNull('auto_decline_failed_at')
            ->whereNull('dispatch_rejected_at')
            ->update(['auto_decline_failed_at' => now()]);

        return $won === 1;
    }
}
