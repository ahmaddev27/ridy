<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

/**
 * Whether a company may use the passwordless Uber login (docs/27), and its per-company
 * options. Gates, all default OFF: the global kill switch (UBER_PASSWORDLESS_LOGIN), the
 * optional rollout allowlist (UBER_PASSWORDLESS_TENANTS, empty = no limit) and the
 * super-admin's per-company flag (`tenants.settings.passwordless_login.enabled`).
 *
 * Variant B (automatic code from a forwarded email) adds, under the same settings key:
 *   auto_code           the company forwards Uber's code email to its secret address
 *   auto_relogin        start a login by itself when the session needs re-auth (needs auto_code)
 *   inbound_token_hash  sha256 of the secret address token - the token itself is never stored
 *   email               the Uber account email (encrypted), used by the automatic login
 */
class PasswordlessLoginSettings
{
    private const TOKEN_LENGTH = 26;

    public function availableFor(?Tenant $tenant): bool
    {
        if ($tenant === null || ! (bool) config('services.passwordless_login.enabled')) {
            return false;
        }

        return $this->allowlisted($tenant) && $tenant->passwordlessLoginEnabled();
    }

    /**
     * Co-browse for Uber's Arkose puzzle (docs/28): the global UBER_COBROWSE_ENABLED, the
     * super-admin's per-company flag, and the passwordless login itself. All default OFF.
     * (A valid proxy is checked by the login service; REAL_CHROME is uber-auth's to gate.)
     */
    public function cobrowseEnabledFor(?Tenant $tenant): bool
    {
        return $tenant !== null
            && (bool) config('services.passwordless_login.cobrowse')
            && $this->availableFor($tenant)
            && $tenant->cobrowseEnabled();
    }

    public function inboundConfigured(Tenant $tenant): bool
    {
        return (string) $this->get($tenant, 'inbound_token_hash') !== '';
    }

    /** Automatic code: opted in AND a secret address exists to receive it. */
    public function autoCodeEnabled(?Tenant $tenant): bool
    {
        return $tenant !== null
            && $this->availableFor($tenant)
            && $this->get($tenant, 'auto_code') === true
            && $this->inboundConfigured($tenant);
    }

    /** Automatic re-login on needs_otp: also needs the Uber account email to log in with. */
    public function autoReloginEnabled(?Tenant $tenant): bool
    {
        return $tenant !== null
            && $this->autoCodeEnabled($tenant)
            && $this->get($tenant, 'auto_relogin') === true
            && $this->email($tenant) !== null;
    }

    public function email(Tenant $tenant): ?string
    {
        $stored = $this->get($tenant, 'email');
        if (! is_string($stored) || $stored === '') {
            return null;
        }
        try {
            return Crypt::decryptString($stored);
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return array{email: ?string, auto_code: bool, auto_relogin: bool, inbound_configured: bool} */
    public function show(Tenant $tenant): array
    {
        return [
            'email' => $this->email($tenant),
            'auto_code' => $this->get($tenant, 'auto_code') === true,
            'auto_relogin' => $this->get($tenant, 'auto_relogin') === true,
            'inbound_configured' => $this->inboundConfigured($tenant),
        ];
    }

    /** @param  array<string, mixed>  $data  validated: email?, auto_code?, auto_relogin? */
    public function update(Tenant $tenant, array $data): void
    {
        $values = [];
        if (array_key_exists('email', $data)) {
            $values['email'] = $data['email'] === null || $data['email'] === '' ? null : Crypt::encryptString((string) $data['email']);
        }
        foreach (['auto_code', 'auto_relogin'] as $key) {
            if (array_key_exists($key, $data)) {
                $values[$key] = (bool) $data[$key];
            }
        }
        // Switching the automatic code off also stops the automatic login that depends on it.
        if (($values['auto_code'] ?? null) === false) {
            $values['auto_relogin'] = false;
        }
        if ($values !== []) {
            $tenant->mergePasswordlessLogin($values);
        }
    }

    /**
     * New secret inbound address. Only the hash is stored, so the address is shown ONCE:
     * rotating again is how a manager who lost it gets a new one (the old stops working).
     */
    public function rotateInboundAddress(Tenant $tenant): string
    {
        $token = Str::lower(Str::random(self::TOKEN_LENGTH));
        $tenant->mergePasswordlessLogin(['inbound_token_hash' => $this->hashToken($token)]);

        return $this->addressFor($token);
    }

    public function addressFor(string $token): string
    {
        return 'uber-'.$token.'@'.$this->inboundDomain();
    }

    public function hashToken(string $token): string
    {
        return hash('sha256', Str::lower($token));
    }

    /** The token inside `uber-<token>@<our domain>`, or null for any other recipient. */
    public function tokenFromRecipient(string $recipient): ?string
    {
        $pattern = '/^uber-([a-z0-9]{'.self::TOKEN_LENGTH.'})@'.preg_quote($this->inboundDomain(), '/').'$/i';

        return preg_match($pattern, trim($recipient), $m) === 1 ? Str::lower($m[1]) : null;
    }

    public function inboundDomain(): string
    {
        return (string) config('services.passwordless_login.inbound_domain', 'in.reidey.de');
    }

    private function get(Tenant $tenant, string $key): mixed
    {
        return $tenant->settings['passwordless_login'][$key] ?? null;
    }

    private function allowlisted(Tenant $tenant): bool
    {
        $allowed = (array) config('services.passwordless_login.tenants', []);

        return $allowed === [] || in_array((string) $tenant->id, array_map('strval', $allowed), true);
    }
}
