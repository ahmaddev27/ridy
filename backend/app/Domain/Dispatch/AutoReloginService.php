<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Tenancy\Models\Tenant;
use App\Jobs\AutoReloginJob;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Variant B's trigger: when a company's persistent session drops to needs_otp and it opted
 * into automatic re-login, start a login by itself (its code then arrives by email). Capped
 * at MAX_PER_DAY automatic attempts per company per 24 h; anything else - gates off, cap
 * spent, no email on file - does nothing, which is exactly variant A (the manager starts it).
 */
class AutoReloginService
{
    public const MAX_PER_DAY = 2;

    private const WINDOW_SECONDS = 86400;

    /** Failed attempts bounce back to needs_otp; never retry faster than this. */
    private const MIN_GAP_SECONDS = 900;

    public function __construct(
        private readonly PasswordlessLoginSettings $settings,
        private readonly PasswordlessLoginService $login,
        private readonly UberAuthClient $client,
    ) {}

    /** Called when the browser service reports a company newly in needs_otp. Never throws. */
    public function onNeedsOtp(int $tenantId): bool
    {
        $tenant = Tenant::find($tenantId);
        if (! $this->eligible($tenant) || ! $this->takeSlot($tenantId)) {
            return false;
        }
        AutoReloginJob::dispatch($tenantId)->delay(now()->addSeconds(random_int(5, 30)));

        return true;
    }

    /** The job's own re-check, right before it acts: state may have changed during the delay. */
    public function run(int $tenantId): void
    {
        $tenant = Tenant::find($tenantId);
        $email = $tenant === null ? null : $this->settings->email($tenant);
        if (! $this->eligible($tenant) || $email === null || ! $this->stillNeedsOtp($tenantId)) {
            return;
        }
        if ($this->login->pendingAutoAttempt($tenant) !== null) {
            return; // an automatic login is already waiting for its code
        }
        $result = $this->login->start($tenant, $email, PasswordlessLoginService::MODE_AUTO, interactive: false);
        Log::info('uber_login.auto_relogin', ['tenant_id' => $tenantId, 'state' => $result['state'] ?? null, 'failure' => $result['failure'] ?? null]);
    }

    private function eligible(?Tenant $tenant): bool
    {
        return $tenant !== null && $this->client->configured() && ! $tenant->isAutolinkBlocked() && $this->settings->autoReloginEnabled($tenant);
    }

    private function stillNeedsOtp(int $tenantId): bool
    {
        return SessionBrowser::where('tenant_id', $tenantId)->value('state') === SessionBrowser::STATE_NEEDS_OTP;
    }

    /** Atomic: at least MIN_GAP apart, and under the cap in a 24 h window. */
    private function takeSlot(int $tenantId): bool
    {
        if (! Cache::add('uber_login:auto_gap:'.$tenantId, 1, self::MIN_GAP_SECONDS)) {
            return false;
        }
        $key = 'uber_login:auto_count:'.$tenantId;
        Cache::add($key, 0, self::WINDOW_SECONDS);

        return Cache::increment($key) <= self::MAX_PER_DAY;
    }
}
