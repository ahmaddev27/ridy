<?php

namespace App\Domain\Dispatch;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockTimeoutException;

/**
 * Passwordless Uber login, variant A — the human relays the one-time code (docs/27).
 *
 *   start(email)  -> uber-auth opens the sign-in; Uber sends the code to the account holder
 *   submitCode()  -> the manager types it; we forward it ONCE and forget it
 *   cancel()      -> abandon the attempt
 *
 * A success needs no handling here: uber-auth hands the logged-in browser to its
 * persistent manager, which posts the capture through the existing internal endpoint
 * (FleetSessionService::capture, via=browser). We only track the attempt.
 *
 * The code is never stored, logged, cached or queued: it exists as a local variable
 * for the duration of one HTTP call. There is no password anywhere in this flow.
 * Result arrays are `{state, mode, channel, expires_at, failure?, retry?}` and never
 * contain the login_id.
 */
class PasswordlessLoginService
{
    public const STATE_IDLE = 'idle';

    public const STATE_STARTING = 'starting';

    public const STATE_AWAITING_CODE = 'awaiting_code';

    public const STATE_SUBMITTING = 'submitting';

    public const STATE_CONNECTED = 'connected';

    public const STATE_FAILED = 'failed';

    /** Wrong codes allowed inside one login before it is abandoned. */
    private const MAX_CODE_TRIES = 3;

    /** start() waits on uber-auth for up to 90 s, so its lock must outlive that. */
    private const START_LOCK = 120;

    private const SUBMIT_LOCK = 45;

    private const UBER_AUTH_FAILURES = ['passkey_unsupported', 'blocked', 'channel_unavailable', 'password_required', 'session_active', 'no_session', 'capture_failed'];

    /** uber-auth answers that mean "still running", never "failed". */
    private const PENDING_STATUSES = ['pending', 'start_in_flight'];

    public function __construct(
        private readonly UberAuthClient $client,
        private readonly LoginAttemptStore $store,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function status(Tenant $tenant): array
    {
        $record = $this->store->get($tenant->id);
        $inFlight = in_array($record['state'] ?? null, [self::STATE_STARTING, self::STATE_SUBMITTING], true);

        // A timed-out start/submit may still have finished on uber-auth's side: a capture
        // accepted since the attempt began is the proof, and settles the attempt.
        return $inFlight && $this->captureLanded($tenant, $record)
            ? $this->connected($tenant, $record)
            : $this->view($record);
    }

    /** @return array<string, mixed> */
    public function start(Tenant $tenant, string $email): array
    {
        if (! $this->client->configured()) {
            return $this->failedView('unavailable');
        }
        if ($this->sessionIsActive($tenant)) {
            return $this->failedView('session_active');
        }
        // Warm re-auth only: a never-connected company is a cold login, which Uber's
        // Arkose challenge reliably stops. Those connect through the extension.
        if (! $this->hasPriorContext($tenant)) {
            return $this->failedView('no_session');
        }

        return $this->locked($tenant, self::START_LOCK, fn () => $this->begin($tenant, $email));
    }

    /** @return array<string, mixed> */
    public function submitCode(Tenant $tenant, string $code): array
    {
        return $this->locked($tenant, self::SUBMIT_LOCK, fn () => $this->relay($tenant, $code));
    }

    /** @return array<string, mixed> */
    public function cancel(Tenant $tenant): array
    {
        return $this->locked($tenant, self::SUBMIT_LOCK, function () use ($tenant) {
            $this->abandon($tenant, $this->store->get($tenant->id));
            $this->store->forget($tenant->id);

            return $this->view(null);
        });
    }

    /** @return array<string, mixed> */
    private function begin(Tenant $tenant, string $email): array
    {
        // One login per company: a second start replaces the first.
        $this->abandon($tenant, $this->store->get($tenant->id));
        $startedAt = CarbonImmutable::now('Europe/Berlin');
        $record = [
            'state' => self::STATE_STARTING,
            'login_id' => null,
            'mode' => 'manual',
            'channel' => null,
            'started_at' => $startedAt->toIso8601String(),
            'expires_at' => $startedAt->addSeconds(LoginAttemptStore::ATTEMPT_TTL)->toIso8601String(),
            'submits' => 0,
        ];
        $this->store->put($tenant->id, $record, LoginAttemptStore::START_WINDOW);
        // No email (or anything derived from it) is kept: not in the cache record, not in the log.
        $this->audit->log('uber_login.started', null, ['mode' => 'manual'], $tenant->id);

        return $this->settleStart($tenant, $record, $this->client->startLogin($tenant, $email));
    }

    /**
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $answer
     * @return array<string, mixed>
     */
    private function settleStart(Tenant $tenant, array $record, array $answer): array
    {
        $status = $answer['status'] ?? 'error';
        if ($status === 'mfa_required' && is_string($answer['login_id'] ?? null)) {
            $record = ['state' => self::STATE_AWAITING_CODE, 'login_id' => $answer['login_id'], 'channel' => $answer['channel'] ?? 'unknown'] + $record;
            $this->store->put($tenant->id, $record);

            return $this->view($record);
        }

        if (in_array($status, self::PENDING_STATUSES, true)) {
            return $this->pendingView($record);
        }

        return $status === 'success' ? $this->connected($tenant, $record) : $this->fail($tenant, $this->failureFor($answer));
    }

    /** @return array<string, mixed> */
    private function relay(Tenant $tenant, string $code): array
    {
        $record = $this->store->get($tenant->id);
        if (($record['state'] ?? null) !== self::STATE_AWAITING_CODE || ! is_string($record['login_id'] ?? null)) {
            return $this->view($record);
        }
        $loginId = $record['login_id'];
        // Remaining lifetime, not a fresh one: this record must never outlive uber-auth's entry.
        $this->store->put($tenant->id, ['state' => self::STATE_SUBMITTING] + $record, $this->remainingTtl($record));

        $answer = $this->client->submitMfa($tenant, $loginId, $code);

        return $this->settleCode($tenant, $record, $answer);
    }

    /**
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $answer
     * @return array<string, mixed>
     */
    private function settleCode(Tenant $tenant, array $record, array $answer): array
    {
        $status = $answer['status'] ?? 'error';
        if ($status === 'success') {
            return $this->connected($tenant, $record);
        }
        if ($status === 'pending') {
            // Timed out waiting: the code may or may not have been accepted. Stay in
            // "submitting" (no second submit) until the record expires or the capture lands.
            return $this->pendingView(['state' => self::STATE_SUBMITTING] + $record);
        }
        if ($status === 'mfa_required' && ($answer['retry'] ?? false) === true) {
            return $this->retryOrGiveUp($tenant, $record);
        }

        return $this->fail($tenant, $this->failureFor($answer));
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    private function retryOrGiveUp(Tenant $tenant, array $record): array
    {
        $record['submits'] = (int) ($record['submits'] ?? 0) + 1;
        if ($record['submits'] >= self::MAX_CODE_TRIES) {
            $this->abandon($tenant, $record);

            return $this->fail($tenant, 'wrong_code');
        }
        $record['state'] = self::STATE_AWAITING_CODE;
        $this->store->put($tenant->id, $record, $this->remainingTtl($record));

        return $this->view($record) + ['retry' => true];
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    private function connected(Tenant $tenant, array $record): array
    {
        // uber-auth said success; only believe it if a fresh capture really landed since the start.
        if (! $this->captureLanded($tenant, $record)) {
            return $this->fail($tenant, 'capture_failed');
        }
        $this->store->put($tenant->id, ['state' => self::STATE_CONNECTED], LoginAttemptStore::RESULT_TTL);
        $this->audit->log('uber_login.connected', null, ['mode' => 'manual'], $tenant->id);

        return $this->view($this->store->get($tenant->id));
    }

    /** @return array<string, mixed> */
    private function fail(Tenant $tenant, string $failure): array
    {
        $this->store->put($tenant->id, ['state' => self::STATE_FAILED, 'failure' => $failure], LoginAttemptStore::RESULT_TTL);
        $this->audit->log('uber_login.failed', null, ['mode' => 'manual', 'failure' => $failure], $tenant->id);

        return $this->failedView($failure);
    }

    /** Tell uber-auth to drop the held browser (best effort; it also expires on its own). */
    private function abandon(Tenant $tenant, ?array $record): void
    {
        $loginId = $record['login_id'] ?? null;
        if (is_string($loginId) && $loginId !== '') {
            $this->client->cancel($tenant, $loginId);
        }
    }

    /** @param  array<string, mixed>  $answer */
    private function failureFor(array $answer): string
    {
        $status = (string) ($answer['status'] ?? 'error');
        if (in_array($status, self::UBER_AUTH_FAILURES, true)) {
            return $status;
        }

        return ($answer['message'] ?? null) === 'unknown or expired login_id' ? 'code_timeout' : 'unavailable';
    }

    /** A healthy browser is feeding the daemon; never start a login that could stall it. */
    private function sessionIsActive(Tenant $tenant): bool
    {
        $browser = SessionBrowser::where('tenant_id', $tenant->id)->first();

        return $browser !== null && $browser->state === SessionBrowser::STATE_ACTIVE && $browser->isLive();
    }

    /**
     * The capture endpoint stamps SessionBrowser.last_capture_at synchronously, before
     * uber-auth answers, so a capture accepted during this attempt is visible right now.
     *
     * @param  array<string, mixed>  $record
     */
    private function captureLanded(Tenant $tenant, array $record): bool
    {
        $startedAt = CarbonImmutable::parse((string) ($record['started_at'] ?? 'now'));
        $last = SessionBrowser::where('tenant_id', $tenant->id)->value('last_capture_at');

        return $last !== null && CarbonImmutable::parse($last)->greaterThanOrEqualTo($startedAt->subSecond());
    }

    /**
     * Still waiting on uber-auth (timeout / start already running): not a failure, so the
     * UI says wait-and-retry instead of racing a login that may still be in progress.
     *
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    private function pendingView(array $record): array
    {
        return $this->view($record) + ['pending' => true];
    }

    /** The company has been connected before: a browser context or a stored Uber session exists. */
    private function hasPriorContext(Tenant $tenant): bool
    {
        return SessionBrowser::where('tenant_id', $tenant->id)->where('state', '!=', SessionBrowser::STATE_NOT_SET_UP)->exists()
            || UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->exists();
    }

    /**
     * @param  array<string, mixed>|null  $record
     * @return array<string, mixed>
     */
    private function view(?array $record): array
    {
        $state = $record['state'] ?? self::STATE_IDLE;
        $view = ['state' => $state, 'mode' => 'manual', 'channel' => $record['channel'] ?? null, 'expires_at' => $record['expires_at'] ?? null];
        if ($state === self::STATE_FAILED) {
            $view['failure'] = $record['failure'] ?? 'unavailable';
        }

        return $view;
    }

    /** @return array<string, mixed> */
    private function failedView(string $failure): array
    {
        return $this->view(['state' => self::STATE_FAILED, 'failure' => $failure]);
    }

    /** @param  array<string, mixed>  $record */
    private function remainingTtl(array $record): int
    {
        return max(1, CarbonImmutable::parse((string) $record['expires_at'])->getTimestamp() - CarbonImmutable::now()->getTimestamp());
    }

    /**
     * @param  callable(): array<string, mixed>  $work
     * @return array<string, mixed>
     */
    private function locked(Tenant $tenant, int $seconds, callable $work): array
    {
        try {
            return $this->store->lock($tenant->id, $seconds)->block(5, $work);
        } catch (LockTimeoutException) {
            return $this->view($this->store->get($tenant->id));
        }
    }
}
