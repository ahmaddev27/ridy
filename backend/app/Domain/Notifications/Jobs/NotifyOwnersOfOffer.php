<?php

namespace App\Domain\Notifications\Jobs;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Push an offer to the tenant's fleet owners/managers running the app in owner mode.
 *
 * Off the hot path on purpose: only the DRIVER has Uber's ~5-second accept window,
 * while the owner fan-out is one FCM call per manager device and used to run
 * sequentially inside it, holding the daemon's ingest request open for the rest of
 * the batch.
 */
class NotifyOwnersOfOffer implements ShouldQueue
{
    use Queueable;

    /** A transient FCM failure is worth one retry; past that the offer is stale. */
    public int $tries = 2;

    public int $backoff = 5;

    public function __construct(
        private readonly int $offerId,
        private readonly ?int $stopsCount = null,
    ) {}

    public function handle(DispatchNotifier $notifier): void
    {
        // Without the tenant scope: the worker has no tenant context, and the notifier
        // scopes owner devices by the offer's own tenant_id.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);
        if ($offer === null) {
            return; // the company was wiped between dispatch and run
        }

        $notifier->notifyOwners($offer, $this->stopsCount);
    }
}
