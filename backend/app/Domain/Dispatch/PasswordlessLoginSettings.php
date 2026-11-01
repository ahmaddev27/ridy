<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;

/**
 * Whether a company may use the passwordless Uber login (docs/27). Three gates, all
 * default OFF: the global kill switch (UBER_PASSWORDLESS_LOGIN), the optional rollout
 * allowlist (UBER_PASSWORDLESS_TENANTS, empty = no limit) and the super-admin's
 * per-company flag (`tenants.settings.passwordless_login.enabled`).
 */
class PasswordlessLoginSettings
{
    public function availableFor(?Tenant $tenant): bool
    {
        if ($tenant === null || ! (bool) config('services.passwordless_login.enabled')) {
            return false;
        }

        return $this->allowlisted($tenant) && $tenant->passwordlessLoginEnabled();
    }

    private function allowlisted(Tenant $tenant): bool
    {
        $allowed = (array) config('services.passwordless_login.tenants', []);

        return $allowed === [] || in_array((string) $tenant->id, array_map('strval', $allowed), true);
    }
}
