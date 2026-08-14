<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The single place every offer state transition happens. Each move is guarded by
 * {@see OfferStatus::canTransitionTo()} and idempotent — applying the same
 * transition twice (a duplicated webhook/poll) is a no-op — so ingestion never
 * double-counts. Since we only observe Uber, transitions are inferred from the
 * driver's status by the caller.
 */
class OfferLifecycle
{
    /** Offers older than this when a trip starts aren't attributed to it. */
    public const ATTRIBUTION_MINUTES = 10;

    /** PENDING → ACCEPTED. Stamps accepted_at (kept forever = "was ever taken"). */
    public function accept(DispatchOffer $offer): bool
    {
        return $this->transition($offer, OfferStatus::Accepted, ['accepted_at' => now()]);
    }

    /** ACCEPTED → STARTED. */
    public function start(DispatchOffer $offer): bool
    {
        return $this->transition($offer, OfferStatus::Started, ['started_at' => now()]);
    }

    /** STARTED → COMPLETED. */
    public function complete(DispatchOffer $offer): bool
    {
        return $this->transition($offer, OfferStatus::Completed, ['completed_at' => now()]);
    }

    /** ACCEPTED → CANCELED. */
    public function cancel(DispatchOffer $offer): bool
    {
        return $this->transition($offer, OfferStatus::Canceled, ['canceled_at' => now()]);
    }

    /** PENDING → REJECTED. */
    public function reject(DispatchOffer $offer): bool
    {
        return $this->transition($offer, OfferStatus::Rejected, ['rejected_at' => now()]);
    }

    /**
     * The driver's in-flight offer, if any — the one that is ACCEPTED or STARTED.
     * There is at most one per driver at a time.
     */
    public function activeOfferFor(int $tenantId, string $driverUuid): ?DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->latest('received_at')
            ->first();
    }

    /**
     * The most recent NOT-yet-taken offer for the driver, within the attribution
     * window — the one a fresh engagement is attributed to. Matched by
     * accepted_at IS NULL (not status), so an offer the expiry sweep already
     * marked REJECTED is still attributable when the driver's acceptance is
     * detected a poll or two later (accept() overturns the rejection).
     */
    public function pendingOfferFor(int $tenantId, string $driverUuid): ?DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->whereNull('accepted_at')
            ->where('received_at', '>=', now()->subMinutes(self::ATTRIBUTION_MINUTES))
            ->latest('received_at')
            ->first();
    }

    /**
     * Mark every pending offer whose accept window has elapsed as rejected. Runs
     * cheaply (indexed) — used both opportunistically and by the scheduled command.
     *
     * @return int rows expired
     */
    public function expirePending(?int $tenantId = null): int
    {
        $now = CarbonImmutable::now();

        // The accept window is per-row, so evaluate the deadline in PHP (portable
        // across sqlite/MySQL). The pending set is small, so this stays cheap.
        $expired = DispatchOffer::withoutGlobalScopes()
            ->where('status', OfferStatus::Pending)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->get(['id', 'received_at', 'accept_window_seconds'])
            ->filter(fn (DispatchOffer $o) => $o->received_at !== null
                && $o->received_at->addSeconds((int) ($o->accept_window_seconds ?? 0) + 30)->isBefore($now))
            ->pluck('id');

        if ($expired->isEmpty()) {
            return 0;
        }

        return DispatchOffer::withoutGlobalScopes()
            ->whereIn('id', $expired)
            ->update(['status' => OfferStatus::Rejected, 'rejected_at' => $now]);
    }

    /**
     * Apply a guarded, idempotent transition. Returns false (no-op) when the move
     * isn't allowed from the current state — so duplicates never double-apply.
     *
     * @param  array<string, mixed>  $stamps
     */
    private function transition(DispatchOffer $offer, OfferStatus $to, array $stamps): bool
    {
        return DB::transaction(function () use ($offer, $to, $stamps) {
            /** @var DispatchOffer $fresh */
            $fresh = DispatchOffer::withoutGlobalScopes()->lockForUpdate()->find($offer->id);
            if ($fresh === null || ! $fresh->status->canTransitionTo($to)) {
                return false;
            }

            $fresh->forceFill(array_merge(['status' => $to], $stamps))->save();
            $offer->setRawAttributes($fresh->getAttributes(), true);

            return true;
        });
    }
}
