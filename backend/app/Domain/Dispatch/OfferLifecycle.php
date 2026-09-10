<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Events\OfferBroadcast;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
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

    /**
     * How recently an already-REJECTED offer must have been rejected to still be
     * re-attributed (a LATE-detected accept: the driver took it just before our sweep
     * marked it rejected). Past this it was genuinely declined and must NEVER be
     * re-accepted onto a later, unrelated trip — the cause of a rejected offer
     * wrongly showing "completed". A still-PENDING offer keeps the full window above.
     */
    public const LATE_ACCEPT_GRACE_MINUTES = 3;

    /** A STARTED offer still open after this is force-completed (safety net). */
    public const MAX_TRIP_MINUTES = 100;

    /** An ACCEPTED-but-never-started offer older than this is force-canceled. */
    public const ACCEPTED_STALE_MINUTES = 20;

    /**
     * How long a driver must have been continuously OFFLINE before their STARTED
     * trip is force-completed — a grace so a brief mid-trip connection blip (offline
     * then back to ON_TRIP) doesn't end a live trip early.
     */
    public const OFFLINE_GRACE_MINUTES = 5;

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
            ->where(fn ($q) => $this->takeableGuard($q))
            ->latest('received_at')
            ->first();
    }

    /**
     * A not-yet-accepted offer is takeable only if it is still PENDING, or was
     * REJECTED very recently (a late-detected accept). A long-rejected offer stays
     * rejected — never re-attributed to an unrelated later trip.
     */
    private function takeableGuard(Builder $q): void
    {
        $q->where('status', '!=', OfferStatus::Rejected)
            ->orWhere('rejected_at', '>=', now()->subMinutes(self::LATE_ACCEPT_GRACE_MINUTES));
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
            ->where(fn ($q) => $this->takeableGuard($q))
            ->latest('received_at')
            ->first();
    }

    /**
     * Safety net for edges the poll never observed (driver went offline mid-trip,
     * a long poll gap): force-complete STARTED offers past the max trip length,
     * force-complete a STARTED offer whose driver is now OFFLINE (they can't be on a
     * trip — the close edge was just never seen), and force-cancel ACCEPTED offers
     * that never started. Returns rows changed.
     */
    public function finalizeStale(?int $tenantId = null): int
    {
        $now = CarbonImmutable::now();

        $completed = $this->finalizeRows(
            DispatchOffer::withoutGlobalScopes()
                ->where('status', OfferStatus::Started)
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->where('started_at', '<', $now->subMinutes(self::MAX_TRIP_MINUTES)),
            OfferStatus::Started,
            ['status' => OfferStatus::Completed, 'completed_at' => $now],
        );

        // A driver who has been OFFLINE past the grace can't still be on a trip — the
        // close edge was never observed (a sign-off / abrupt disconnect). Complete it
        // now instead of waiting out the 100-minute cap, but only after the grace so a
        // brief mid-trip blip (offline → back ON_TRIP) doesn't end a live trip early.
        // The grace is measured from went_offline_at (cleared when the driver returns),
        // so a blip that reconnects resets it. Only offers linked to a driver count.
        $offlineCompleted = $this->finalizeRows(
            DispatchOffer::withoutGlobalScopes()
                ->where('status', OfferStatus::Started)
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->whereHas('driver', fn ($q) => $q->offline()
                    ->where('went_offline_at', '<', $now->subMinutes(self::OFFLINE_GRACE_MINUTES))),
            OfferStatus::Started,
            ['status' => OfferStatus::Completed, 'completed_at' => $now],
        );

        $canceled = $this->finalizeRows(
            DispatchOffer::withoutGlobalScopes()
                ->where('status', OfferStatus::Accepted)
                ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
                ->where('accepted_at', '<', $now->subMinutes(self::ACCEPTED_STALE_MINUTES)),
            OfferStatus::Accepted,
            ['status' => OfferStatus::Canceled, 'canceled_at' => $now],
        );

        return $completed + $offlineCompleted + $canceled;
    }

    /**
     * Materialise a sweep's target rows, apply the bulk update, then announce each
     * row (see {@see announce()}). $from re-guards the UPDATE so a row that moved on
     * between the SELECT and the write is left alone.
     *
     * @param  Builder<DispatchOffer>  $query
     * @param  array<string, mixed>  $stamps
     * @return int rows changed
     */
    private function finalizeRows(Builder $query, OfferStatus $from, array $stamps): int
    {
        $rows = $query->get(['id', 'driver_id', 'tenant_id']);
        if ($rows->isEmpty()) {
            return 0;
        }

        $changed = DispatchOffer::withoutGlobalScopes()
            ->whereIn('id', $rows->pluck('id'))
            ->where('status', $from)
            ->update($stamps);

        $this->announce($rows);

        return $changed;
    }

    /**
     * Mark every pending offer whose accept window has elapsed as rejected. Runs
     * cheaply (indexed) — used both opportunistically and by the scheduled command.
     *
     * @return int rows expired
     */
    /**
     * A driver holds AT MOST ONE pending offer: when a newer offer arrives, any
     * still-pending older offer of theirs is superseded → rejected (idle or engaged
     * alike), so the list never shows two pending offers for one driver. If the
     * driver actually takes a superseded offer, the attribution overturns the
     * rejection (pendingOfferFor matches accepted_at IS NULL). Returns rows changed.
     */
    public function supersedePendingFor(int $tenantId, string $driverUuid, int $keepOfferId): int
    {
        if ($driverUuid === '') {
            return 0;
        }

        $rows = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->where('id', '!=', $keepOfferId)
            ->where('status', OfferStatus::Pending)
            ->get(['id', 'driver_id', 'tenant_id']);

        return $this->rejectRows($rows);
    }

    /**
     * The driver became available again (a trip ended → back to idle-online) without
     * taking a still-pending offer: they were free and never engaged on it, so it was
     * passed on. Reject every pending offer of theirs. A coarse poll that briefly
     * reports idle between back-to-back trips is safe — if the driver actually engages
     * on it a poll later, {@see accept()} overturns this rejection within the
     * {@see LATE_ACCEPT_GRACE_MINUTES} grace (pendingOfferFor matches accepted_at IS
     * NULL). Returns rows changed.
     */
    public function rejectPendingFor(int $tenantId, string $driverUuid): int
    {
        if ($driverUuid === '') {
            return 0;
        }

        $rows = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->where('status', OfferStatus::Pending)
            ->get(['id', 'driver_id', 'tenant_id']);

        return $this->rejectRows($rows);
    }

    /**
     * A driver holds exactly ONE active trip. When a newer offer becomes active (or
     * the driver goes idle), any OTHER offer of theirs still ACCEPTED/STARTED is a
     * trip whose close edge we missed — a rapid trip-to-trip jump, or a sub-minute
     * flicker that {@see tripLooksReal} left STARTED. Finalize it: complete a STARTED
     * one (the driver was on the trip) and cancel an ACCEPTED-but-never-started one,
     * so a driver never shows two live trips and phantom trips don't linger until the
     * 100-minute stale sweep. Returns rows changed.
     */
    public function supersedeActiveFor(int $tenantId, string $driverUuid, int $keepOfferId): int
    {
        if ($driverUuid === '') {
            return 0;
        }

        $stale = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->where('id', '!=', $keepOfferId)
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->get();

        $changed = 0;
        foreach ($stale as $offer) {
            $ok = $offer->status === OfferStatus::Started
                ? $this->complete($offer)
                : $this->cancel($offer);
            $changed += $ok ? 1 : 0;
        }

        return $changed;
    }

    public function expirePending(?int $tenantId = null): int
    {
        // Resolve a pending offer by the driver's availability, NOT by a blanket timer:
        //   • ENGAGED (en route / on a trip) → HOLD it (bounded only by the 2h cap):
        //     it may be a back-to-back the driver takes once free, so timing it out now
        //     would wrongly flip it to "not taken" a poll before they accept it.
        //   • IDLE (online, not engaged) and the accept window has elapsed → REJECT:
        //     the driver was free and did not take it, so it was passed on. This is the
        //     case the pure event model missed — a driver who is ALREADY idle when the
        //     offer arrives (or whose engaged→idle edge a coarse poll skipped) would
        //     otherwise sit "pending" forever until a newer offer or the 2h cap.
        //   • OFFLINE → REJECT: they left without taking it.
        //   • Past the 2h cap → REJECT regardless (a dead session / unlinked offer).
        // A late-detected take within LATE_ACCEPT_GRACE_MINUTES still overturns the
        // rejection (pendingOfferFor matches accepted_at IS NULL), so this never loses a
        // real acceptance the poll saw a moment late.
        $now = CarbonImmutable::now();
        $hardCap = $now->subHours(2);

        // The accept window is per-row, so evaluate the deadline in PHP (portable
        // across sqlite/MySQL). The pending set is small, so this stays cheap.
        $expired = DispatchOffer::withoutGlobalScopes()
            ->where('status', OfferStatus::Pending)
            ->when($tenantId !== null, fn ($q) => $q->where('tenant_id', $tenantId))
            ->with('driver:id,online_status')
            ->get(['id', 'received_at', 'accept_window_seconds', 'driver_id', 'tenant_id'])
            ->filter(function (DispatchOffer $o) use ($now, $hardCap) {
                if ($o->received_at === null) {
                    return false;
                }
                // Absolute backstop — expire regardless of state (dead session / unlinked).
                if ($o->received_at->isBefore($hardCap)) {
                    return true;
                }
                // Unlinked offers have no driver to judge availability from — wait for the cap.
                if ($o->driver === null) {
                    return false;
                }
                // Hold it while the driver is ENGAGED (a possible back-to-back trip).
                if ($o->driver->engagementStatus() >= 1) {
                    return false;
                }
                // Offline → they left without taking it → reject now.
                if (! $o->driver->isOnline()) {
                    return true;
                }

                // Idle-online → reject once the accept window (+grace) has elapsed.
                return $o->received_at
                    ->addSeconds((int) ($o->accept_window_seconds ?? 0) + 30)
                    ->isBefore($now);
            })
            ->values();

        return $this->rejectRows($expired);
    }

    /**
     * Reject a materialised set of pending offers in one UPDATE, then announce each
     * one.
     *
     * The status guard is kept on the UPDATE so an offer the driver accepted between
     * the SELECT and here is not flipped back to rejected.
     *
     * @param  Collection<int, DispatchOffer>  $rows
     * @return int rows changed
     */
    private function rejectRows($rows): int
    {
        if ($rows->isEmpty()) {
            return 0;
        }

        $changed = DispatchOffer::withoutGlobalScopes()
            ->whereIn('id', $rows->pluck('id'))
            ->where('status', OfferStatus::Pending)
            ->update(['status' => OfferStatus::Rejected, 'rejected_at' => CarbonImmutable::now()]);

        $this->announce($rows);

        return $changed;
    }

    /**
     * Announce a bulk state change on the live channels.
     *
     * {@see transition()} broadcasts per row, but the sweeps issue one bulk UPDATE
     * and used to bypass it entirely — so the most common rejection paths in the
     * system (a newer offer superseding an older one, a driver returning to idle, the
     * per-minute expiry sweep) produced no WebSocket event at all. Nothing was wrong,
     * because the dashboard and app fall back to polling; but a manager watching the
     * live feed saw an offer sit "Open" while the database already said Rejected,
     * which reads exactly like the stuck-pending bug. Best-effort per row: an offer
     * with no linked driver has no channel, and a broadcast must never break a sweep.
     *
     * @param  Collection<int, DispatchOffer>  $rows
     */
    private function announce($rows): void
    {
        foreach ($rows as $offer) {
            if ($offer->driver_id === null) {
                continue;
            }

            rescue(
                fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->tenant_id, (int) $offer->id, 'status')),
                report: false,
            );
        }
    }

    /**
     * Apply a guarded, idempotent transition. Returns false (no-op) when the move
     * isn't allowed from the current state — so duplicates never double-apply.
     *
     * @param  array<string, mixed>  $stamps
     */
    private function transition(DispatchOffer $offer, OfferStatus $to, array $stamps): bool
    {
        $changed = DB::transaction(function () use ($offer, $to, $stamps) {
            /** @var DispatchOffer $fresh */
            $fresh = DispatchOffer::withoutGlobalScopes()->lockForUpdate()->find($offer->id);
            if ($fresh === null || ! $fresh->status->canTransitionTo($to)) {
                return false;
            }

            $fresh->forceFill(array_merge(['status' => $to], $stamps))->save();
            $offer->setRawAttributes($fresh->getAttributes(), true);

            return true;
        });

        // Real-time nudge so the driver's open app reflects the new status (taken /
        // on-trip / completed) instantly. Best-effort — never breaks the transition.
        if ($changed && $offer->driver_id !== null) {
            rescue(fn () => broadcast(new OfferBroadcast((int) $offer->driver_id, (int) $offer->tenant_id, (int) $offer->id, 'status')), report: false);
        }

        return $changed;
    }
}
