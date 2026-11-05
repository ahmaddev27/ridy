<?php

namespace App\Domain\Dispatch;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Persists the software passkey uber-auth registered (docs/31). The credential (private
 * key) is stored encrypted and is NEVER logged or audited - only its sha256 id hash is.
 */
class PasskeyService
{
    public const MAX_CONSECUTIVE_FAILURES = 2;

    private const FAILURES_KEY = 'passkey:relogin_failures:';

    private const BREAKER_KEY = 'passkey:relogin_breaker:';

    private const BREAKER_TTL = 604800; // 7 days; a successful sign-in resets it

    public function __construct(private PasskeySettings $settings, private AuditLogger $audit) {}

    public function isEnabledFor(?Tenant $tenant): bool
    {
        return $this->settings->availableFor($tenant);
    }

    public function hasActive(int $tenantId): bool
    {
        return UberPasskey::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', UberPasskey::STATUS_ACTIVE)
            ->exists();
    }

    /** @param array<string, mixed> $credential */
    public function store(Tenant $tenant, array $credential, ?string $orgUuid = null): UberPasskey
    {
        $hash = hash('sha256', (string) ($credential['credentialId'] ?? ''));

        $passkey = DB::transaction(fn () => UberPasskey::withoutGlobalScopes()->updateOrCreate(
            ['tenant_id' => $tenant->id],
            [
                'uber_org_uuid' => $orgUuid,
                'credential_id_hash' => $hash,
                'credential' => $credential,
                'status' => UberPasskey::STATUS_ACTIVE,
                'registered_at' => now(),
                'failure_reason' => null,
            ],
        ));

        $this->audit->log('passkey.registered', null, ['credential_id_hash' => $hash], $tenant->id);

        return $passkey;
    }

    /**
     * Remember a failed attempt and shout about it. Never downgrades a live passkey: an
     * active row stays active (the failure is only logged). `session_lost` means the
     * registration attempt may have cost the company its Uber session - needs a human.
     */
    public function recordFailure(int $tenantId, string $reason): void
    {
        $reason = mb_substr($reason, 0, 190);
        $passkey = UberPasskey::withoutGlobalScopes()->firstOrNew(['tenant_id' => $tenantId]);
        if ($passkey->status !== UberPasskey::STATUS_ACTIVE) {
            $passkey->forceFill(['status' => UberPasskey::STATUS_FAILED, 'failure_reason' => $reason])->save();
        }

        $this->audit->log('passkey.failed', null, ['reason' => $reason], $tenantId);
        Log::critical('uber passkey registration failure', ['tenant_id' => $tenantId, 'reason' => $reason]);
    }

    public function markUsed(int $tenantId): void
    {
        UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->update(['last_used_at' => now(), 'use_count' => DB::raw('use_count + 1')]);
    }

    /** A confirmed passkey sign-in: persist the authenticator's new signCount, then count the use. */
    public function recordSignIn(int $tenantId, ?int $signCount = null): void
    {
        $passkey = UberPasskey::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)->where('status', UberPasskey::STATUS_ACTIVE)->first();
        if ($signCount !== null && $passkey !== null && is_array($passkey->credential)) {
            $credential = $passkey->credential;
            $credential['signCount'] = max($signCount, (int) ($credential['signCount'] ?? 0));
            $passkey->credential = $credential;
            $passkey->save();
        }
        $this->markUsed($tenantId);
        $this->recordLoginResult($tenantId, true);
    }

    /** Should /login/start ask uber-auth to sign in with the passkey? Gates + an active key + breaker closed. */
    public function shouldOfferForRelogin(Tenant $tenant): bool
    {
        return $this->settings->reloginAvailableFor($tenant)
            && ! Cache::has(self::BREAKER_KEY.$tenant->id)
            && $this->hasActive($tenant->id);
    }

    /**
     * Track consecutive passkey sign-in outcomes. After MAX_CONSECUTIVE_FAILURES in a row the
     * breaker opens (the passkey is no longer offered to this company) and an alert fires.
     */
    public function recordLoginResult(int $tenantId, bool $ok): void
    {
        $counter = self::FAILURES_KEY.$tenantId;
        if ($ok) {
            Cache::forget($counter);
            Cache::forget(self::BREAKER_KEY.$tenantId);

            return;
        }
        Cache::add($counter, 0, self::BREAKER_TTL);
        if (Cache::increment($counter) < self::MAX_CONSECUTIVE_FAILURES) {
            return;
        }
        Cache::put(self::BREAKER_KEY.$tenantId, true, self::BREAKER_TTL);
        $this->audit->log('passkey.relogin_breaker_open', null, [], $tenantId);
        Log::critical('uber passkey re-login disabled after consecutive failures', ['tenant_id' => $tenantId]);
    }

    /**
     * The DECRYPTED credential in the exact shape CDP `WebAuthn.addCredential` consumes
     * (what `WebAuthn.getCredentials` returned at registration), or null when the company
     * has no ACTIVE passkey or the flags are off. This is the single accessor the co-browse
     * injection uses; the secret leaves only through the internal endpoint that calls it.
     *
     * @return array{credentialId: string, isResidentCredential: bool, rpId: string, privateKey: string, userHandle: ?string, signCount: int}|null
     */
    public function credentialForInjection(Tenant $tenant): ?array
    {
        if (! $this->isEnabledFor($tenant)) {
            return null;
        }
        $passkey = UberPasskey::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('status', UberPasskey::STATUS_ACTIVE)
            ->first();
        $c = $passkey?->credential;
        if (! is_array($c) || empty($c['credentialId']) || empty($c['privateKey'])) {
            return null;
        }

        return [
            'credentialId' => (string) $c['credentialId'],
            'isResidentCredential' => ($c['isResidentCredential'] ?? true) !== false,
            'rpId' => (string) ($c['rpId'] ?? 'uber.com'),
            'privateKey' => (string) $c['privateKey'],
            'userHandle' => isset($c['userHandle']) ? (string) $c['userHandle'] : null,
            'signCount' => (int) ($c['signCount'] ?? 0),
        ];
    }

    public function revoke(int $tenantId): void
    {
        UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->update(['status' => UberPasskey::STATUS_REVOKED]);
    }
}
