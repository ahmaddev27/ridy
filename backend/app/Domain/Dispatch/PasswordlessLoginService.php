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

    private const UBER_AUTH_FAILURES = ['passkey_unsupported', 'blocked', 'channel_unavailable', 'password_required', 'session_active', 'no_session'];

    public function __construct(
        private readonly UberAuthClient $client,
        private readonly LoginAttemptStore $store,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function status(Tenant $tenant): array
    {
        return $this->view($this->store->get($tenant->id));
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
            'email_hash' => $this->store->hashEmail($email),
            'started_at' => $startedAt->toIso8601String(),
            'expires_at' => $startedAt->addSeconds(LoginAttemptStore::ATTEMPT_TTL)->toIso8601String(),
            'submits' => 0,
        ];
        $this->store->put($tenant->id, $record, LoginAttemptStore::START_WINDOW);
        $this->audit->log('uber_login.started', null, ['mode' => 'manual', 'email' => substr($record['email_hash'], 0, 8)], $tenant->id);

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

        return $status === 'success' ? $this->connected($tenant) : $this->fail($tenant, $this->failureFor($answer));
    }

    /** @return array<string, mixed> */
    private function relay(Tenant $tenant, string $code): array
    {
        $record = $this->store->get($tenant->id);
        if (($record['state'] ?? null) !== self::STATE_AWAITING_CODE || ! is_string($record['login_id'] ?? null)) {
            return $this->view($record);
        }
        $loginId = $record['login_id'];
        $this->store->put($tenant->id, ['state' => self::STATE_SUBMITTING] + $record);

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
            return $this->connected($tenant);
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

    /** @return array<string, mixed> */
    private function connected(Tenant $tenant): array
    {
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
        return max(1, CarbonImmutable::parse((string) $record['expires_at'])->getTimestamp() - time());
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
