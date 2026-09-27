<?php

namespace App\Domain\Auth;

use Carbon\CarbonImmutable;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Sliding (idle) expiry + throttled last-used tracking for Sanctum tokens.
 *
 * Registered as Sanctum's access-token authentication callback, so it runs for
 * every bearer token on every guard (dashboard PATs, extension, driver app,
 * fleet-owner app). An absolute lifetime would log every driver out on some
 * fixed date; an idle lifetime only kills tokens nobody has used for weeks
 * (reinstalls, lost phones, failed logouts) while phones in daily use live on.
 */
class TokenLifecycle
{
    public static function authenticate(PersonalAccessToken $token, bool $isValid): bool
    {
        if (! $isValid) {
            return false;
        }

        $now = CarbonImmutable::now();
        $lastSeen = $token->last_used_at ?? $token->created_at;

        $idleDays = (int) config('sanctum.idle_expiration_days', 0);
        if ($idleDays > 0 && $lastSeen !== null && $lastSeen->lt($now->subDays($idleDays))) {
            return false;
        }

        self::touch($token, $now);

        return true;
    }

    /**
     * Refresh last_used_at at most once per interval — the driver app polls every
     * few seconds, and one UPDATE per poll was a hot write on this table.
     */
    private static function touch(PersonalAccessToken $token, CarbonImmutable $now): void
    {
        $interval = max(1, (int) config('sanctum.last_used_at_interval', 10));
        if ($token->last_used_at !== null && $token->last_used_at->gt($now->subMinutes($interval))) {
            return;
        }

        $token->newQuery()->whereKey($token->getKey())->update(['last_used_at' => $now]);
        $token->setAttribute('last_used_at', $now);
        $token->syncOriginalAttribute('last_used_at');
    }
}
