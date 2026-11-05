<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;

/**
 * Whether a company may have a software passkey registered on its Uber account (docs/31).
 * Every gate defaults OFF: the global switch (UBER_PASSKEY_REGISTER), the optional
 * allowlist (UBER_PASSKEY_TENANTS, empty = no limit) and the super-admin's per-company
 * flag (`tenants.settings.passkey.enabled`). Signing in with it on the unattended re-login
 * has its own extra gates (UBER_PASSKEY_RELOGIN + `settings.passkey.relogin`).
 */
class PasskeySettings
{
    public function availableFor(?Tenant $tenant): bool
    {
        return $tenant !== null
            && (bool) config('services.passkey.enabled')
            && $this->allowlisted($tenant)
            && ($tenant->settings['passkey']['enabled'] ?? false) === true;
    }

    /** May the unattended re-login SIGN IN with the stored passkey? Every gate defaults OFF. */
    public function reloginAvailableFor(?Tenant $tenant): bool
    {
        return $this->availableFor($tenant)
            && (bool) config('services.passkey.relogin')
            && ($tenant->settings['passkey']['relogin'] ?? false) === true;
    }

    private function allowlisted(Tenant $tenant): bool
    {
        $allowed = (array) config('services.passkey.tenants', []);

        return $allowed === [] || in_array((string) $tenant->id, array_map('strval', $allowed), true);
    }
}
