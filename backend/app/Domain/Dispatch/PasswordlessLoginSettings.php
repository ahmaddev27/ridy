<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

/**
 * Whether a company may use the passwordless Uber login (docs/27), and its per-company
 * options. Gates, all default OFF: the global kill switch (UBER_PASSWORDLESS_LOGIN), the
 * (the old UBER_PASSWORDLESS_TENANTS allowlist is ignored) and the
 * super-admin's per-company flag (`tenants.settings.passwordless_login.enabled`).
 *
 * Variant B (automatic code from a forwarded email) adds, under the same settings key:
 *   auto_code           on once the secret address is provisioned (automatic, nobody types anything)
 *   auto_relogin        start a login by itself when the session needs re-auth (needs auto_code + email)
 *   inbound_token_hash  sha256 of the secret address token - the lookup key for the inbound handler
 *   inbound_token       the token, ENCRYPTED, so the stable address can be shown read-only to the operator
 *   email               the Uber account email (encrypted), captured from the connect flow
 */
class PasswordlessLoginSettings
{
    private const TOKEN_LENGTH = 26;

    public function availableFor(?Tenant $tenant): bool
    {
        if ($tenant === null || ! (bool) config('services.passwordless_login.enabled')) {
            return false;
        }

        // UBER_PASSWORDLESS_TENANTS no longer restricts: co-browse is the default for every company.
        return $tenant->passwordlessLoginEnabled();
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
     * The company's stable secret forwarding address, minted lazily on first access, which
     * also switches the automatic code + re-login on (no operator toggle, nothing typed).
     * Only ever read through the tenant it belongs to - never cross-tenant.
     */
    public function ensureInboundAddress(Tenant $tenant): string
    {
        $existing = $this->inboundAddress($tenant);
        if ($existing !== null) {
            return $existing;
        }
        $address = $this->rotateInboundAddress($tenant);
        $this->update($tenant, ['auto_code' => true, 'auto_relogin' => true]);

        return $address;
    }

    /** The stored address, or null if none was minted yet (a legacy hash-only one cannot be shown). */
    public function inboundAddress(Tenant $tenant): ?string
    {
        $stored = $this->get($tenant, 'inbound_token');
        if (! is_string($stored) || $stored === '') {
            return null;
        }
        try {
            return $this->addressFor(Crypt::decryptString($stored));
        } catch (\Throwable) {
            return null;
        }
    }

    /** New secret inbound address; the previous one stops working. */
    public function rotateInboundAddress(Tenant $tenant): string
    {
        $token = Str::lower(Str::random(self::TOKEN_LENGTH));
        $tenant->mergePasswordlessLogin([
            'inbound_token_hash' => $this->hashToken($token),
            'inbound_token' => Crypt::encryptString($token),
        ]);

        return $this->addressFor($token);
    }

    /** Remember the Uber account email the manager connected with (encrypted) for the automatic re-login. */
    public function rememberEmail(Tenant $tenant, string $email): void
    {
        $email = trim($email);
        if ($email !== '' && $this->email($tenant) !== $email) {
            $this->update($tenant, ['email' => $email]);
        }
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
}
