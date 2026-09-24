<?php

namespace App\Domain\Auth;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Named rate limiters for the auth surface and the machine ingest endpoints.
 *
 * Plain `throttle:N,1` keys every route on the same "user id / client IP" slot,
 * so unrelated endpoints drained each other's budget and nothing ever limited
 * per ACCOUNT. These limiters give each family its own counter and key the
 * credential/OTP ones on the target email as well as the client, so a rotating
 * pool of IPs can no longer grind one account.
 */
class AuthRateLimits
{
    public static function register(): void
    {
        // Password checks (dashboard login, company activate / payment-claim, the
        // app's legacy password login) share ONE per-email budget.
        RateLimiter::for('credentials', fn (Request $request) => [
            Limit::perMinute(10)->by('ip:'.self::clientKey($request)),
            ...self::perEmail($request, Limit::perMinutes(15, 20)),
        ]);

        // Anything that emails a one-time code: sign-in, password reset, sign-up.
        RateLimiter::for('otp-send', fn (Request $request) => [
            Limit::perMinute(6)->by('ip:'.self::clientKey($request)),
            ...self::perEmail($request, Limit::perHour(8)),
        ]);

        // Code verification. Wrong guesses are also capped per email by OtpGuard,
        // across every re-issued code.
        RateLimiter::for('otp-verify', fn (Request $request) => [
            Limit::perMinute(12)->by('ip:'.self::clientKey($request)),
            ...self::perEmail($request, Limit::perHour(60)),
        ]);

        // Browser-extension ingest (roster / statuses / metrics / vehicles /
        // capture). Generous: a real extension posts every few seconds at most.
        RateLimiter::for('ext-ingest', fn (Request $request) => Limit::perMinute(240)
            ->by('ext:'.self::principalKey($request)));

        // Offer ingest must never drop a real offer — only a runaway loop hits this.
        RateLimiter::for('ext-offers', fn (Request $request) => Limit::perMinute(1200)
            ->by('ext-offers:'.self::principalKey($request)));

        // The dispatch daemon (shared secret). Only a ceiling against abuse of a
        // leaked secret; every shard's legitimate burst stays far below it.
        RateLimiter::for('dispatch-internal', fn (Request $request) => Limit::perMinute(6000)
            ->by('dispatch:'.self::clientKey($request)));
    }

    /**
     * The client key for per-IP limits. IPv6 clients are grouped by their /64 —
     * one subscriber usually owns a whole /64, so keying on the full address let
     * a single attacker rotate through billions of "different" clients.
     */
    public static function clientKey(Request $request): string
    {
        $ip = (string) $request->ip();
        if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return $ip;
        }

        $packed = inet_pton($ip);

        return $packed === false ? $ip : bin2hex(substr($packed, 0, 8)).'::/64';
    }

    /** The normalised email of the request, or null when none was sent. */
    public static function email(Request $request): ?string
    {
        $email = $request->input('email');
        if (! is_string($email)) {
            return null;
        }
        $email = mb_strtolower(trim($email));

        return $email === '' ? null : $email;
    }

    /** @return array<int, Limit> */
    private static function perEmail(Request $request, Limit $limit): array
    {
        $email = self::email($request);

        return $email === null ? [] : [$limit->by('email:'.sha1($email))];
    }

    /** Per token (or user / client) key for the authenticated ingest limits. */
    private static function principalKey(Request $request): string
    {
        $user = $request->user();
        $token = $user !== null && method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;
        // A dashboard session carries a TransientToken (no id) — key it by user.
        $tokenId = $token instanceof Model ? $token->getKey() : null;

        return match (true) {
            $tokenId !== null => 'token:'.$tokenId,
            $user !== null => 'user:'.$user->getAuthIdentifier(),
            default => 'ip:'.self::clientKey($request),
        };
    }
}
