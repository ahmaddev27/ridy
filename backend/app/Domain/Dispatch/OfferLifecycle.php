<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
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
    /** A freshly-arrived offer older than this isn't attributed to a new engagement. */
    public const ATTRIBUTION_MINUTES = 15;

    /** A STARTED offer still open after this is force-completed (safety net). */
    public const MAX_TRIP_MINUTES = 100;

    /** An ACCEPTED-but-never-started offer older than this is force-canceled. */
    public const ACCEPTED_STALE_MINUTES = 20;

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
     * The next not-yet-taken offer the driver picked up while already engaged —
     * i.e. the back-to-back offer that arrived AFTER the current trip's offer. Not
     * age-capped (a long trip can be 100 min), only bounded by "newer than the
     * active offer", so it can never grab a stale one from before this trip.
     */
    public function nextTakeableOfferAfter(int $tenantId, string $driverUuid, CarbonInterface $after): ?DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->whereNull('accepted_at')
            ->where('received_at', '>', $after)
            ->latest('received_at')
            ->first();
    }

    /**
     * Safety net for edges the poll never observed (driver went offline mid-trip,
     * a long poll gap): force-complete STARTED offers past the max trip length and
     * force-cancel ACCEPTED offers that never started. Returns rows changed.
     */
    public function finalizeStale(?int $tenantId = null): int
    {
        $now = CarbonImmutable::now();

        $completed = DispatchOffer::withoutGlobalScopes()
            ->where('status', OfferStatus::Started)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->where('started_at', '<', $now->subMinutes(self::MAX_TRIP_MINUTES))
            ->update(['status' => OfferStatus::Completed, 'completed_at' => $now]);

        $canceled = DispatchOffer::withoutGlobalScopes()
            ->where('status', OfferStatus::Accepted)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->where('accepted_at', '<', $now->subMinutes(self::ACCEPTED_STALE_MINUTES))
            ->update(['status' => OfferStatus::Canceled, 'canceled_at' => $now]);

        return $completed + $canceled;
    }

    /**
     * Mark every pending offer whose accept window has elapsed as rejected. Runs
     * cheaply (indexed) — used both opportunistically and by the scheduled command.
     *
     * @return int rows expired
     */
    /**
     * A driver holds at most one pending offer: when a newer one arrives, any
     * still-pending older offer for the same driver is superseded ("not taken") —
     * a new offer means Uber moved past the previous one. Skip it while the driver
     * is engaged (they took the earlier one back-to-back; the transition accepts
     * it). Returns rows changed.
     */
    public function supersedePendingFor(int $tenantId, string $driverUuid, int $keepOfferId): int
    {
        if ($driverUuid === '') {
            return 0;
        }

        $driver = Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('uber_driver_uuid', $driverUuid)
            ->first(['id', 'online_status']);

        if ($driver !== null && $driver->engagementStatus() >= 1) {
            return 0; // busy — leave the earlier offer for the back-to-back transition
        }

        return DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->where('id', '!=', $keepOfferId)
            ->where('status', OfferStatus::Pending)
            ->update(['status' => OfferStatus::Rejected, 'rejected_at' => CarbonImmutable::now()]);
    }

    public function expirePending(?int $tenantId = null): int
    {
        $now = CarbonImmutable::now();
        // Even a busy driver's offer can't linger forever (dead session / missed
        // "idle" edge) — expire past this absolute cap regardless of engagement.
        $hardCap = $now->subHours(2);

        // The accept window is per-row, so evaluate the deadline in PHP (portable
        // across sqlite/MySQL). The pending set is small, so this stays cheap.
        $expired = DispatchOffer::withoutGlobalScopes()
            ->where('status', OfferStatus::Pending)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->with('driver:id,online_status')
            ->get(['id', 'received_at', 'accept_window_seconds', 'driver_id'])
            ->filter(function (DispatchOffer $o) use ($now, $hardCap) {
                if ($o->received_at === null) {
                    return false;
                }
                $windowPassed = $o->received_at
                    ->addSeconds((int) ($o->accept_window_seconds ?? 0) + 30)
                    ->isBefore($now);
                if (! $windowPassed) {
                    return false;
                }
                // Hold it while the driver is still on/heading to a trip: they take
                // it back-to-back once free, so marking it "not taken" now would be
                // wrong (it just flickers to accepted a poll later). Only expire an
                // engaged driver's offer past the hard cap.
                $engaged = $o->driver !== null && $o->driver->engagementStatus() >= 1;

                return ! $engaged || $o->received_at->isBefore($hardCap);
            })
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
