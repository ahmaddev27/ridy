<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;

/**
 * Whether a company may have a software passkey registered on its Uber account (docs/31).
 * The global switch (UBER_PASSKEY_REGISTER, default OFF) and the optional
 * allowlist (UBER_PASSKEY_TENANTS, empty = no limit) gate it; the per-company flag
 * (`tenants.settings.passkey.enabled`) is opt-OUT: unset = on, only an explicit false disables.
 * Signing in with it on the unattended re-login has its own gates (UBER_PASSKEY_RELOGIN,
 * default OFF, + `settings.passkey.relogin`, also opt-out).
 */
class PasskeySettings
{
    public function availableFor(?Tenant $tenant): bool
    {
        return $tenant !== null
            && (bool) config('services.passkey.enabled')
            && $this->allowlisted($tenant)
            && ($tenant->settings['passkey']['enabled'] ?? true) !== false;
    }

    /** May the unattended re-login SIGN IN with the stored passkey? The global flag defaults OFF; the per-company flag is opt-out. */
    public function reloginAvailableFor(?Tenant $tenant): bool
    {
        return $this->availableFor($tenant)
            && (bool) config('services.passkey.relogin')
            && ($tenant->settings['passkey']['relogin'] ?? true) !== false;
    }

    private function allowlisted(Tenant $tenant): bool
    {
        $allowed = (array) config('services.passkey.tenants', []);

        return $allowed === [] || in_array((string) $tenant->id, array_map('strval', $allowed), true);
    }
}
