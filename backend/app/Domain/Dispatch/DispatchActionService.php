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

        $session = $this->liveSession($offer->tenant_id);

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
            && ! $this->deliveryDeadline($offer)->isPast()
            // The session predicate belongs here too, or this diverges from
            // requestReject() exactly where it matters most: companies whose offers
            // come from the manager's browser extension have no residential proxy
            // and therefore no live stream, so the feature is genuinely unavailable
            // to them. It is also the gate the driver app uses to decide whether to
            // open the pop-up at all, so a false positive here means a modal whose
            // only button answers "no_session".
            && $this->hasLiveSession($offer->tenant_id);
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
        ?bool $success,
        ?string $error = null,
        ?int $callMs = null,
    ): void {
        $command->forceFill([
            // null (no verdict) is a failed command but NOT a recorded refusal:
            // uber_success stays null so the measurement can tell "Uber said no"
            // apart from "we never heard", which are different facts about the
            // deadline we are trying to find.
            'status' => $success === true ? DispatchCommandStatus::Succeeded : DispatchCommandStatus::Failed,
            'uber_success' => $success,
            'uber_error' => $error !== null ? mb_substr($error, 0, 255) : null,
            'latency_ms' => $this->endToEndLatency($command, $callMs),
            'completed_at' => now(),
        ])->save();

        if ($success !== true) {
            Log::warning($success === false ? 'dispatch_action.refused_by_uber' : 'dispatch_action.no_verdict', [
                'command_id' => $command->id,
                'offer_id' => $command->dispatch_offer_id,
                'action' => $command->action->value,
                'error' => $error,
                'call_ms' => $callMs,
                'offer_age_ms' => $command->latency_ms,
            ]);

            return;
        }

        $offer = $command->offer;
        if ($offer === null) {
            return;
        }

        // Uber accepted the decline, but the offer may have moved on in the seconds
        // the round trip took: DriverStatusIngestor infers an accept from the
        // driver's engagement edge, so by now the row can already be ACCEPTED,
        // STARTED or even COMPLETED.
        //
        // Never stamp a taken offer. dispatch_rejected_at means "this never reached
        // the driver", and on a real trip that is a lie with teeth: the offer drops
        // out of their stats entirely, so its fare and kilometres vanish from their
        // earnings, while the dashboard renders a finished trip as declined.
        //
        // Uber's verdict is still recorded on the command row either way, so the
        // disagreement stays visible rather than being silently resolved in favour
        // of the decline. A race this way round means the driver got the ride — and
        // the ride is the truth worth keeping.
        $offer->refresh();

        if ($offer->displayStatus()->isTaken() || $offer->accepted_at !== null) {
            Log::warning('dispatch_action.offer_already_taken', [
                'command_id' => $command->id,
                'offer_id' => $offer->id,
                'status' => $offer->displayStatus()->value,
            ]);

            return;
        }

        // Stamped BEFORE the transition: it is what keeps the offer out of the
        // driver's stats and out of OfferLifecycle::takeableGuard, and it has to
        // hold even when the status move is a no-op.
        $offer->forceFill(['dispatch_rejected_at' => now()])->save();
        $this->lifecycle->reject($offer);

        RidyLog::event('dispatch_action.applied', [
            'command_id' => $command->id,
            'offer_id' => $offer->id,
            'action' => $command->action->value,
            'call_ms' => $callMs,
            // How old the offer was when Uber accepted the decline — the number the
            // unknown deadline turns on, so it belongs in the one event that fires
            // on a success.
            'offer_age_ms' => $command->latency_ms,
        ]);
    }

    /**
     * The session whose live jar can carry the mutation.
     *
     * Only a session a daemon is actually streaming can send anything: offers
     * captured by the manager's browser extension belong to companies with no
     * residential proxy, which Uber answers on RAMEN with 404. For them the feature
     * is genuinely unavailable, and both requestReject() and canReject() say so
     * rather than queueing work nothing will ever pick up.
     *
     * Memoized per tenant: canReject() runs once per offer in a list that the
     * dashboard polls every few seconds.
     *
     * @var array<int, UberFleetSession|null>
     */
    private array $sessionCache = [];

    private function liveSession(?int $tenantId): ?UberFleetSession
    {
        if ($tenantId === null) {
            return null;
        }

        return $this->sessionCache[$tenantId] ??= UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->latest('id')
            ->first();
    }

    private function hasLiveSession(?int $tenantId): bool
    {
        return $this->liveSession($tenantId) !== null;
    }

    /**
     * How old the offer was when Uber answered, in ms — the one number that can
     * settle the open question this feature exists under: Uber's real deadline for
     * a dispatch decline is unknown, and `acceptWindowInSeconds` (always 5) may be
     * the DRIVER's window rather than the panel's.
     *
     * Measured from Uber's own clock (`offer_generated_at`), so it is the offer's
     * true age and not our ingest latency subtracted out. It includes the daemon's
     * report hop back to us — tens of milliseconds against a window measured in
     * seconds, and erring high is the safe direction for a deadline estimate.
     *
     * Falls back to the daemon's own call duration when Uber sent no generation
     * time (never seen across 1003 production offers, so this is a guard).
     */
    private function endToEndLatency(OfferDispatchCommand $command, ?int $callMs): ?int
    {
        $generatedAt = $command->offer?->offer_generated_at;

        if ($generatedAt === null) {
            return $callMs;
        }

        // Guard the clock: Uber's epoch-ms and ours can disagree, and a negative or
        // absurd age would poison the very measurement this column exists for.
        $age = (int) round(now()->diffInMilliseconds($generatedAt, absolute: true));

        return $age >= 0 && $age < 600_000 ? $age : $callMs;
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
        // An expired command is NOT a duplicate. Both clients read 'duplicate' as
        // "the panel has it, Uber's answer is coming", so reporting it that way
        // would leave the driver on "sent" for an answer nothing is going to
        // produce. It is a retry candidate like a failure: nobody ever collected
        // it, so it was never attempted.
        if ($existing->status === DispatchCommandStatus::Expired) {
            return $this->requeue($existing, $expiresAt);
        }

        if (! $existing->status->isRetryable()) {
            return ['status' => 'duplicate', 'command_id' => $existing->id];
        }

        return $this->requeue($existing, $expiresAt);
    }

    /**
     * Put a settled-but-unapplied command back in the queue.
     *
     * Bounded by MAX_ATTEMPTS, which counts DELIVERIES rather than taps: it is how
     * many times this one offer may ever be handed to Uber, so a stuck client
     * cannot turn one offer into a stream of mutations.
     *
     * @return array{status: string, reason?: string, command_id?: int}
     */
    private function requeue(OfferDispatchCommand $existing, CarbonImmutable $expiresAt): array
    {
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
