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

    /**
     * Past this age a queued owner copy is dropped: after a worker outage or a
     * failed-jobs "retry all" it would otherwise ring every manager's phone for
     * offers that were decided long ago.
     */
    public const MAX_AGE_SECONDS = 60;

    /** Unix time the job was queued (null on payloads queued before this field existed). */
    public ?int $queuedAt = null;

    public function __construct(
        private readonly int $offerId,
        private readonly ?int $stopsCount = null,
    ) {
        $this->queuedAt = time();
    }

    public function handle(DispatchNotifier $notifier): void
    {
        // Relative to when it was QUEUED — not the offer's status or received_at: the
        // multi-stop follow-up is queued after acceptance and must still go out.
        if ($this->queuedAt !== null && time() - $this->queuedAt > self::MAX_AGE_SECONDS) {
            return;
        }

        // Without the tenant scope: the worker has no tenant context, and the notifier
        // scopes owner devices by the offer's own tenant_id.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);
        if ($offer === null) {
            return; // the company was wiped between dispatch and run
        }

        $notifier->notifyOwners($offer, $this->stopsCount);
    }
}
