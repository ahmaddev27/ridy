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

    public const MODE_MANUAL = 'manual';

    public const MODE_AUTO = 'auto';

    public const SOURCE_MANUAL = 'manual';

    public const SOURCE_INBOUND = 'inbound';

    /** Seconds an emailed code waits for the lock (start() may still be running). */
    private const INBOUND_WAIT = 30;

    /** Wrong codes allowed inside one login before it is abandoned. */
    private const MAX_CODE_TRIES = 3;

    /** start() waits on uber-auth for up to 90 s, so its lock must outlive that. */
    private const START_LOCK = 120;

    private const SUBMIT_LOCK = 45;

    private const UBER_AUTH_FAILURES = ['passkey_unsupported', 'blocked', 'channel_unavailable', 'password_required', 'session_active', 'no_session', 'no_proxy', 'capture_failed', 'wrong_code'];

    /** uber-auth answers that mean "still running", never "failed". */
    private const PENDING_STATUSES = ['pending', 'start_in_flight'];

    public function __construct(
        private readonly UberAuthClient $client,
        private readonly LoginAttemptStore $store,
        private readonly AuditLogger $audit,
        private readonly PasswordlessLoginSettings $settings,
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
    public function start(Tenant $tenant, string $email, string $mode = self::MODE_MANUAL): array
    {
        if (! $this->client->configured()) {
            return $this->failedView('unavailable');
        }
        if ($this->sessionIsActive($tenant)) {
            return $this->failedView('session_active');
        }
        // No prior context at all (no browser row, no stored session) = a COLD first connect.
        // Only reachable here because sessionIsActive() already refused any live session;
        // uber-auth enforces the same (and its own flag) before it ever launches a browser.
        $cold = ! $this->hasPriorContext($tenant);
        if ($cold && ! (bool) config('services.passwordless_login.cold')) {
            return $this->failedView('no_session');
        }
        // A cold login from the VPS datacenter IP is the Arkose-prone case and would tie the
        // account to that IP: it only ever runs through the company's own residential proxy.
        if ($cold && ! $this->hasValidProxy($tenant)) {
            return $this->failedView('no_proxy');
        }

        // The automatic mode needs the company's opt-in and its secret address; without them
        // it is just the manual flow (the manager types the code).
        $mode = $mode === self::MODE_AUTO && $this->settings->autoCodeEnabled($tenant) ? self::MODE_AUTO : self::MODE_MANUAL;

        return $this->locked($tenant, self::START_LOCK, fn () => $this->begin($tenant, $email, $mode, $cold));
    }

    /** @return array<string, mixed> */
    public function submitCode(Tenant $tenant, string $code, string $source = self::SOURCE_MANUAL): array
    {
        $relayed = false;

        return $this->submit($tenant, $code, $source, $relayed);
    }

    /**
     * An emailed code (variant B). True only if it was really handed to uber-auth - false
     * when there was nothing to relay it to (attempt gone, already tried, lock timeout), so
     * the caller never records a submission that did not happen.
     */
    public function submitInboundCode(Tenant $tenant, string $code): bool
    {
        $relayed = false;
        $this->submit($tenant, $code, self::SOURCE_INBOUND, $relayed);

        return $relayed;
    }

    /** @return array<string, mixed> */
    private function submit(Tenant $tenant, string $code, string $source, bool &$relayed): array
    {
        // An emailed code can arrive while start() still holds the lock: wait for it.
        $wait = $source === self::SOURCE_INBOUND ? self::INBOUND_WAIT : 5;

        // A closure (not fn): the flag must be shared by reference, arrow functions copy it.
        return $this->locked($tenant, self::SUBMIT_LOCK, function () use ($tenant, $code, $source, &$relayed) {
            return $this->relay($tenant, $code, $source, $relayed);
        }, $wait);
    }

    /**
     * The attempt an emailed code may still go to: automatic mode, still waiting for its
     * code, and not already given its one automated try. Null = nothing pending.
     *
     * @return array<string, mixed>|null
     */
    public function pendingAutoAttempt(Tenant $tenant): ?array
    {
        $record = $this->store->get($tenant->id);
        $waiting = in_array($record['state'] ?? null, [self::STATE_STARTING, self::STATE_AWAITING_CODE], true);

        return $record !== null && $waiting && ($record['mode'] ?? null) === self::MODE_AUTO && empty($record['auto_submitted'])
            ? $record
            : null;
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
    private function begin(Tenant $tenant, string $email, string $mode, bool $cold): array
    {
        // One login per company: a second start replaces the first.
        $this->abandon($tenant, $this->store->get($tenant->id));
        $startedAt = CarbonImmutable::now('Europe/Berlin');
        $record = [
            'state' => self::STATE_STARTING,
            'login_id' => null,
            'mode' => $mode,
            'auto_submitted' => false,
            'channel' => null,
            'started_at' => $startedAt->toIso8601String(),
            'expires_at' => $startedAt->addSeconds(LoginAttemptStore::ATTEMPT_TTL)->toIso8601String(),
            'submits' => 0,
            'cold' => $cold,
        ];
        $this->store->put($tenant->id, $record, LoginAttemptStore::START_WINDOW);
        // No email (or anything derived from it) is kept: not in the cache record, not in the log.
        $this->audit->log('uber_login.started', null, ['mode' => $mode, 'cold' => $cold], $tenant->id);

        return $this->settleStart($tenant, $record, $this->client->startLogin($tenant, $email, $cold));
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
    private function relay(Tenant $tenant, string $code, string $source, bool &$relayed): array
    {
        $record = $this->store->get($tenant->id);
        if (($record['state'] ?? null) !== self::STATE_AWAITING_CODE || ! is_string($record['login_id'] ?? null)) {
            return $this->view($record);
        }
        if ($source === self::SOURCE_INBOUND) {
            // Exactly one automated try per login, and only in automatic mode.
            if (($record['mode'] ?? null) !== self::MODE_AUTO || ! empty($record['auto_submitted'])) {
                return $this->view($record);
            }
            $record['auto_submitted'] = true;
        }
        // A cold login may only ever fill an EMPTY slot. The extension (or auto-relink) can have
        // connected the company since start(): then ours is abandoned, never forked onto it.
        if (! empty($record['cold']) && $this->hasPriorContext($tenant)) {
            $this->abandon($tenant, $record);

            return $this->fail($tenant, 'session_active');
        }
        $loginId = $record['login_id'];
        // Remaining lifetime, not a fresh one: this record must never outlive uber-auth's entry.
        $this->store->put($tenant->id, ['state' => self::STATE_SUBMITTING] + $record, $this->remainingTtl($record));

        $relayed = true;
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
            return $this->retryOrGiveUp($tenant, $record, $answer);
        }

        return $this->fail($tenant, $this->failureFor($answer));
    }

    /**
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $answer
     * @return array<string, mixed>
     */
    private function retryOrGiveUp(Tenant $tenant, array $record, array $answer = []): array
    {
        // uber-auth moved to the next code channel by itself: a fresh code is on its way, so this
        // is a continuation, not a wrong code. Only a same-channel rejection burns a try.
        $switched = ($answer['switched'] ?? false) === true;
        if (is_string($answer['channel'] ?? null)) {
            $record['channel'] = $answer['channel'];
        }
        $record['submits'] = (int) ($record['submits'] ?? 0) + ($switched ? 0 : 1);
        if ($record['submits'] >= self::MAX_CODE_TRIES) {
            $this->abandon($tenant, $record);

            return $this->fail($tenant, 'wrong_code');
        }
        $record['state'] = self::STATE_AWAITING_CODE;
        // A wrong automated code hands the login to the manager, who types the real one.
        $record['mode'] = self::MODE_MANUAL;
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
        $this->audit->log('uber_login.connected', null, ['mode' => $record['mode'] ?? self::MODE_MANUAL], $tenant->id);

        return $this->view($this->store->get($tenant->id));
    }

    /** @return array<string, mixed> */
    private function fail(Tenant $tenant, string $failure): array
    {
        $mode = $this->store->get($tenant->id)['mode'] ?? self::MODE_MANUAL;
        $this->store->put($tenant->id, ['state' => self::STATE_FAILED, 'failure' => $failure], LoginAttemptStore::RESULT_TTL);
        $this->audit->log('uber_login.failed', null, ['mode' => $mode, 'failure' => $failure], $tenant->id);

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

    /** Whether the connect page may offer the cold (email + code) first connect: flag on and nothing connected yet. */
    public function coldConnectAvailable(?Tenant $tenant): bool
    {
        return $tenant !== null
            && (bool) config('services.passwordless_login.cold')
            && $this->settings->availableFor($tenant)
            && ! $this->hasPriorContext($tenant);
    }

    /**
     * Email + code is the company's primary connect path (the extension is neither offered nor
     * nagged): passwordless is on AND either it has connected before (warm) or cold is available.
     */
    public function codeLoginIsPrimary(?Tenant $tenant): bool
    {
        return $tenant !== null && $this->settings->availableFor($tenant)
            && ($this->hasPriorContext($tenant) || (bool) config('services.passwordless_login.cold'));
    }

    /** Mirrors uber-auth's parseProxyUrl: a usable http/https/socks5 proxy with a host. */
    private function hasValidProxy(Tenant $tenant): bool
    {
        $parts = parse_url(trim((string) $tenant->getAttribute('proxy_url')));

        return is_array($parts) && in_array($parts['scheme'] ?? '', ['http', 'https', 'socks5'], true) && ($parts['host'] ?? '') !== '';
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
        $view = ['state' => $state, 'mode' => $record['mode'] ?? self::MODE_MANUAL, 'channel' => $record['channel'] ?? null, 'expires_at' => $record['expires_at'] ?? null];
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
    private function locked(Tenant $tenant, int $seconds, callable $work, int $wait = 5): array
    {
        try {
            return $this->store->lock($tenant->id, $seconds)->block($wait, $work);
        } catch (LockTimeoutException) {
            return $this->view($this->store->get($tenant->id));
        }
    }
}
