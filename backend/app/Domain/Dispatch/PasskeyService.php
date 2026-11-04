<?php

namespace App\Domain\Dispatch;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\UberPasskey;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Persists the software passkey uber-auth registered (docs/29). The credential (private
 * key) is stored encrypted and is NEVER logged or audited - only its sha256 id hash is.
 */
class PasskeyService
{
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

    public function recordFailure(int $tenantId, string $reason): void
    {
        UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->update(['status' => UberPasskey::STATUS_FAILED, 'failure_reason' => mb_substr($reason, 0, 190)]);
    }

    public function markUsed(int $tenantId): void
    {
        UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->update(['last_used_at' => now(), 'use_count' => DB::raw('use_count + 1')]);
    }

    public function revoke(int $tenantId): void
    {
        UberPasskey::withoutGlobalScopes()->where('tenant_id', $tenantId)
            ->update(['status' => UberPasskey::STATUS_REVOKED]);
    }
}
