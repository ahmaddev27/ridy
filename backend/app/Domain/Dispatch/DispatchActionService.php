<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Models\User;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Queues and resolves dispatch-side actions on Uber — the ONE place this product
 * writes to Uber instead of only observing it.
 *
 * It only ever writes rows. The daemon performs the mutation (it holds the live
 * vsdispatch jar and the company's residential proxy) and reports the verdict
 * back through {@see applyResult}.
 *
 * Results use the house convention of a status + reason array rather than
 * exceptions, matching {@see DispatchOfferIngestor::ingest}.
 */
class DispatchActionService
{
    /**
     * Uber's offer type for the reject mutation.
     *
     * Hardcoded because it is a CLIENT constant, not a per-offer value: the field is
     * absent from all 1003 real production payloads inspected (and no alternative
     * key carries it), while Uber's own dispatch panel sends "JOB". A payload value
     * still wins if Uber ever starts sending one — see {@see offerTypeFor}.
     */
    public const DEFAULT_OFFER_TYPE = 'JOB';

    /**
     * How long past the offer's own window a queued command may still be delivered.
     *
     * Deliberately generous. Uber's real deadline for a dispatch decline is NOT
     * known — `acceptWindowInSeconds` is 5 on every offer, but whether that is the
     * panel's deadline or the driver's has never been measured. Refusing to even
     * try past 5 seconds would guarantee we never find out.
     *
     * So we attempt late declines and RECORD what Uber answers (`uber_success` +
     * `uber_error` + `latency_ms`). After a day of production the real deadline is
     * readable straight off this table, and the window can then be tightened to
     * match. The feature is its own measuring instrument.
     */
    public const DELIVERY_GRACE_SECONDS = 60;

    /** Floor for the offer window when Uber sends none (never seen in practice). */
    public const MIN_WINDOW_SECONDS = 15;

    /** Guards a runaway client: one offer is never retried more than this. */
    public const MAX_ATTEMPTS = 3;

    public function __construct(private OfferLifecycle $lifecycle) {}

    /**
     * Ask Uber to decline this offer from the dispatch panel.
     *
     * The caller is responsible for authorizing the actor against the offer (the
     * driver routes scope by driver_id, the dashboard route by permission); this
     * re-checks everything that is about the OFFER rather than the caller.
     *
     * @return array{status: string, reason?: string, command_id?: int}
     */
    public function requestReject(DispatchOffer $offer, ?Driver $driver = null, ?User $user = null): array
    {
        $tenant = $offer->tenant;

        if ($tenant === null || ! $tenant->dispatchRejectEnabled()) {
            return ['status' => 'refused', 'reason' => 'disabled'];
        }

        if ($offer->dispatch_rejected_at !== null) {
            return ['status' => 'already_declined'];
        }

        if ($offer->displayStatus() !== OfferStatus::Pending) {
            return ['status' => 'refused', 'reason' => 'not_pending'];
        }

        // Uber needs realOfferUUID. Present on all 1003 production offers inspected,
        // so this is a guard rather than an expected path — but the column has never
        // been read in production before now, so never fire a malformed mutation.
        if (($offer->real_offer_uuid ?? '') === '') {
            return ['status' => 'refused', 'reason' => 'missing_real_offer_uuid'];
        }

        if (($offer->driver_uuid ?? '') === '') {
            return ['status' => 'refused', 'reason' => 'missing_driver_uuid'];
        }

        $expiresAt = $this->deliveryDeadline($offer);
        if ($expiresAt->isPast()) {
            return ['status' => 'refused', 'reason' => 'window_closed'];
        }

        // Only a session the daemon is actually streaming can carry the mutation.
        // Offers captured by the manager's browser extension belong to companies
        // with no residential proxy and therefore no live stream: the feature is
        // genuinely unavailable for them, and the API says so rather than queueing
        // work nothing will ever pick up.
        $session = UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $offer->tenant_id)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->latest('id')
            ->first();

        if ($session === null) {
            return ['status' => 'refused', 'reason' => 'no_session'];
        }

        return $this->queue($offer, $session, $expiresAt, $driver, $user);
    }

    /**
     * Whether a decline could be requested for this offer right now — the same
     * predicates as requestReject, so the UI can hide the button instead of
     * offering one that fails on tap.
     */
    public function canReject(DispatchOffer $offer): bool
    {
        $tenant = $offer->tenant;

        return $tenant !== null
            && $tenant->dispatchRejectEnabled()
            && $offer->dispatch_rejected_at === null
            && $offer->displayStatus() === OfferStatus::Pending
            && ($offer->real_offer_uuid ?? '') !== ''
            && ($offer->driver_uuid ?? '') !== ''
            && ! $this->deliveryDeadline($offer)->isPast();
    }

    /**
     * Record Uber's verdict and settle the offer.
     *
     * ONLY isSuccess: true moves the offer. A refused decline must leave it pending:
     * a false `rejected` would read as "not taken" on the dashboard, would corrupt
     * the driver's stats, and would break the inferred-accept path that still has to
     * work if the driver takes the ride after all.
     */
    public function applyResult(
        OfferDispatchCommand $command,
        bool $success,
        ?string $error = null,
        ?int $latencyMs = null,
    ): void {
        $command->forceFill([
            'status' => $success ? DispatchCommandStatus::Succeeded : DispatchCommandStatus::Failed,
            'uber_success' => $success,
            'uber_error' => $error !== null ? mb_substr($error, 0, 255) : null,
            'latency_ms' => $latencyMs,
            'completed_at' => now(),
        ])->save();

        if (! $success) {
            Log::warning('dispatch_action.refused_by_uber', [
                'command_id' => $command->id,
                'offer_id' => $command->dispatch_offer_id,
                'action' => $command->action->value,
                'error' => $error,
                'latency_ms' => $latencyMs,
            ]);

            return;
        }

        $offer = $command->offer;
        if ($offer === null) {
            return;
        }

        // Stamp the marker BEFORE the transition: it is what keeps the offer out of
        // the driver's stats and out of OfferLifecycle::takeableGuard, and it must
        // hold even if the status move is a no-op because something else already
        // moved the row.
        $offer->forceFill(['dispatch_rejected_at' => now()])->save();
        $this->lifecycle->reject($offer);

        RidyLog::event('dispatch_action.applied', [
            'command_id' => $command->id,
            'offer_id' => $offer->id,
            'action' => $command->action->value,
            'latency_ms' => $latencyMs,
        ]);
    }

    /** Mark a command nothing claimed in time, so the UI stops waiting on it. */
    public function expire(OfferDispatchCommand $command): void
    {
        $command->forceFill([
            'status' => DispatchCommandStatus::Expired,
            'completed_at' => now(),
        ])->save();
    }

    /**
     * The last moment a queued command may still be handed to a daemon.
     *
     * Measured from Uber's OWN clock (`offer_generated_at`) when present rather than
     * our `received_at`, so the deadline reflects the offer's real age instead of
     * hiding our ingest latency inside it.
     */
    public function deliveryDeadline(DispatchOffer $offer): CarbonImmutable
    {
        $base = $offer->offer_generated_at ?? $offer->received_at ?? CarbonImmutable::now();
        $window = max((int) ($offer->accept_window_seconds ?? 0), self::MIN_WINDOW_SECONDS);

        return CarbonImmutable::parse($base)->addSeconds($window + self::DELIVERY_GRACE_SECONDS);
    }

    /** Uber's offer type: the payload's own value if it ever has one, else the constant. */
    public function offerTypeFor(DispatchOffer $offer): string
    {
        $stored = $offer->offer_type;
        if (is_string($stored) && $stored !== '') {
            return $stored;
        }

        $raw = data_get($offer->raw_payload, 'offerType');
        if (is_string($raw) && $raw !== '') {
            // Uber started sending a type. Surface it — "always JOB" would no longer
            // hold, and a type we have never declined before may behave differently.
            Log::warning('dispatch_action.unexpected_offer_type', [
                'offer_id' => $offer->id,
                'offer_type' => $raw,
            ]);

            return $raw;
        }

        return self::DEFAULT_OFFER_TYPE;
    }

    /**
     * Create the command, or reuse the one that already exists for this offer.
     *
     * unique(dispatch_offer_id, action) makes a double tap, a retried POST and two
     * devices of the same driver collapse onto one row instead of firing Uber twice.
     *
     * @return array{status: string, reason?: string, command_id?: int}
     */
    private function queue(
        DispatchOffer $offer,
        UberFleetSession $session,
        CarbonImmutable $expiresAt,
        ?Driver $driver,
        ?User $user,
    ): array {
        $payload = [
            'tenant_id' => $offer->tenant_id,
            'dispatch_offer_id' => $offer->id,
            'uber_fleet_session_id' => $session->id,
            'action' => DispatchCommandAction::Reject,
            'driver_id' => $driver?->id,
            'user_id' => $user?->id,
            'offer_uuid' => $offer->offer_uuid,
            'real_offer_uuid' => $offer->real_offer_uuid,
            'offer_type' => $this->offerTypeFor($offer),
            'driver_uuid' => $offer->driver_uuid,
            'status' => DispatchCommandStatus::Queued,
            'expires_at' => $expiresAt,
        ];

        try {
            $command = DB::transaction(fn () => OfferDispatchCommand::create($payload));
        } catch (QueryException $e) {
            $existing = OfferDispatchCommand::withoutGlobalScopes()
                ->where('dispatch_offer_id', $offer->id)
                ->where('action', DispatchCommandAction::Reject)
                ->first();

            if ($existing === null) {
                throw $e;
            }

            return $this->reuse($existing, $expiresAt);
        }

        RidyLog::event('dispatch_action.queued', [
            'command_id' => $command->id,
            'offer_id' => $offer->id,
            'driver_id' => $driver?->id,
            'user_id' => $user?->id,
        ]);

        return ['status' => 'queued', 'command_id' => $command->id];
    }

    /**
     * A command for this offer already exists. In flight or done, the answer is the
     * same row; only a FAILED one is re-queued, and only while attempts allow — so a
     * driver can try again after Uber refused, without a stuck client being able to
     * hammer Uber.
     *
     * @return array{status: string, reason?: string, command_id?: int}
     */
    private function reuse(OfferDispatchCommand $existing, CarbonImmutable $expiresAt): array
    {
        if (! $existing->status->isRetryable()) {
            return ['status' => 'duplicate', 'command_id' => $existing->id];
        }

        if ($existing->attempts >= self::MAX_ATTEMPTS) {
            return ['status' => 'refused', 'reason' => 'too_many_attempts', 'command_id' => $existing->id];
        }

        $existing->forceFill([
            'status' => DispatchCommandStatus::Queued,
            'expires_at' => $expiresAt,
            'uber_success' => null,
            'uber_error' => null,
            'completed_at' => null,
            'claimed_at' => null,
        ])->save();

        return ['status' => 'queued', 'command_id' => $existing->id];
    }
}
