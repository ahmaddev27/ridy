<?php

namespace App\Domain\Notifications\Jobs;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Notifications\DispatchNotifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Push an offer to the tenant's fleet owners/managers running the app in owner mode.
 *
 * Off the hot path on purpose: only the DRIVER has Uber's ~5-second accept window,
 * while the owner fan-out is one FCM call per manager device and used to run
 * sequentially inside it, holding the daemon's ingest request open for the rest of
 * the batch.
 *
 * Runs on its own queue ({@see QUEUE}), served before `default`, so a backlog of
 * slow geocode/trip-sync jobs cannot age owner copies past the cutoff below.
 */
class NotifyOwnersOfOffer implements ShouldQueue
{
    use Queueable;

    /**
     * Attempts here are mostly RELEASES, not failures: the job puts itself back
     * while it waits for the geocode (see GEO_WAIT_BUDGET_SECONDS) and a release
     * spends an attempt. `maxExceptions` keeps the original rule for a real
     * failure — a transient FCM error is worth one retry, past that the offer is
     * stale — so widening `tries` for the wait cannot turn into an FCM retry storm.
     */
    public int $tries = 8;

    public int $maxExceptions = 2;

    public int $backoff = 5;

    /**
     * How long the manager's copy waits for the metrics before going out bare.
     *
     * The driver's push cannot wait — Uber's accept window is ~5 seconds and on a
     * declines-enabled company the pre-push geocode is skipped ENTIRELY so the
     * decline pop-up is up as fast as possible. **The manager's copy has no such
     * window**: the only decline they can trigger is on the dispatch panel (web),
     * `DispatchOfferController::dispatchReject` behind `can:offers.manage` — the
     * app's single decline route is `auth:driver` and its pop-up is driver-only.
     * Their push is a monitor, so a few seconds buys it the distance and €/km that
     * are most of what it is for.
     *
     * Measured on production 18.10.2026: offer 22311 was received at 13:02:23 and
     * geocoded at 13:06:14 — the number existed, 3m51s too late for a push already
     * sent. On the two declines-enabled companies that was EVERY offer.
     *
     * The budget is a floor on usefulness, never a cost to correctness: once it is
     * spent the push goes out exactly as it does today, bare. It also ends as soon
     * as `geo_synced_at` is stamped, which the geocoder does even when it decides
     * not to trust a distance — so a withheld distance is not waited on twice.
     *
     * Only the OFFER push waits. The multi-stop follow-up is queued after the driver
     * accepted, by which point the trip is resolved from Uber's own waypoints, so it
     * has nothing to wait for and holding it back would delay a push about a ride
     * already under way.
     *
     * Nor does it wait on the `sync` connection: a released job is retried only by a
     * real queue, and on `sync` there is no later attempt — the copy would be lost
     * rather than delayed. Production runs `database`; the test suite runs `sync`.
     */
    public const GEO_WAIT_SECONDS = 3;

    public const GEO_WAIT_BUDGET_SECONDS = 18;

    /**
     * Past this age a queued owner copy is dropped: after a worker outage or a
     * failed-jobs "retry all" it would otherwise ring every manager's phone for
     * offers that were decided long ago.
     */
    public const MAX_AGE_SECONDS = 60;

    /**
     * The multi-stop follow-up is queued after acceptance and describes a trip that
     * is still running, so it stays useful for longer.
     */
    public const MULTI_STOP_MAX_AGE_SECONDS = 180;

    public const QUEUE = 'push';

    /** Unix time the job was queued (null on payloads queued before this field existed). */
    public ?int $queuedAt = null;

    public function __construct(
        private readonly int $offerId,
        private readonly ?int $stopsCount = null,
    ) {
        $this->queuedAt = time();
        $this->onQueue(self::QUEUE);
    }

    public function handle(DispatchNotifier $notifier): void
    {
        // Relative to when it was QUEUED — not the offer's status or received_at: the
        // multi-stop follow-up is queued after acceptance and must still go out.
        $maxAge = $this->stopsCount === null ? self::MAX_AGE_SECONDS : self::MULTI_STOP_MAX_AGE_SECONDS;
        if ($this->queuedAt !== null && time() - $this->queuedAt > $maxAge) {
            // Logged, so a queue backlog that silences owner pushes is visible.
            Log::info('owner offer push dropped: queue age exceeded', [
                'offer_id' => $this->offerId, 'age' => time() - $this->queuedAt, 'stops' => $this->stopsCount,
            ]);

            return;
        }

        // Without the tenant scope: the worker has no tenant context, and the notifier
        // scopes owner devices by the offer's own tenant_id.
        $offer = DispatchOffer::withoutGlobalScopes()->find($this->offerId);
        if ($offer === null) {
            return; // the company was wiped between dispatch and run
        }

        // Declined on the dispatch panel while this sat on the queue. A decline
        // resolves in seconds — well inside MAX_AGE_SECONDS — so without this the
        // manager's phone would ring for an offer that is already dead, which is
        // exactly the noise the feature is meant to remove.
        if ($offer->dispatch_rejected_at !== null) {
            return;
        }

        // Wait, briefly, for the numbers — see GEO_WAIT_BUDGET_SECONDS. A copy that
        // reads "16.79 €" when the row will read "16.79 €€ · 16.2 km · €1.04/km" a
        // moment later is the worse of the two pushes, and the manager is not racing
        // anyone for it. The row is re-read on every attempt, so a release picks up
        // whatever landed meanwhile. A payload with no `queuedAt` (queued before that
        // field existed) cannot be bounded, so it never waits.
        if ($this->stopsCount === null && $offer->geo_synced_at === null && $this->queuedAt !== null
            && config('queue.default') !== 'sync'
            && time() - $this->queuedAt < self::GEO_WAIT_BUDGET_SECONDS) {
            $this->release(self::GEO_WAIT_SECONDS);

            return;
        }

        $notifier->notifyOwners($offer, $this->stopsCount);
    }
}
