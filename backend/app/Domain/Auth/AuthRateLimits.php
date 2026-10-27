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
        // app's legacy password login). The tight per-account budget is keyed on
        // account + client network, so a stranger guessing from elsewhere can't
        // lock the real user out; the account-wide ceiling is the looser backstop
        // against a rotating IP pool.
        RateLimiter::for('credentials', fn (Request $request) => [
            Limit::perMinute(10)->by('ip:'.self::clientKey($request)),
            ...self::perEmailAndClient($request, Limit::perMinutes(15, 20)),
            ...self::perEmail($request, Limit::perMinutes(15, 50)),
        ]);

        // Anything that emails a one-time code: sign-in, password reset, sign-up.
        // Same split, so someone else spamming requests can't use up the owner's
        // ability to ask for a fresh code.
        RateLimiter::for('otp-send', fn (Request $request) => [
            Limit::perMinute(6)->by('ip:'.self::clientKey($request)),
            ...self::perEmailAndClient($request, Limit::perHour(8)),
            ...self::perEmail($request, Limit::perHour(20)),
        ]);

        // Code verification. Deliberately NO account-wide request cap here: it
        // would lock the owner out without a single real guess. Wrong guesses
        // against a live code are capped per account by OtpGuard instead.
        RateLimiter::for('otp-verify', fn (Request $request) => [
            Limit::perMinute(12)->by('ip:'.self::clientKey($request)),
            ...self::perEmailAndClient($request, Limit::perHour(60)),
        ]);

        // Browser-extension ingest (roster / statuses / metrics / vehicles /
        // capture). Generous: a real extension posts about once a minute. Offer
        // ingest (extension + daemon) is deliberately NOT throttled — it is the
        // latency-critical path and the limiter costs a cache write per request.
        RateLimiter::for('ext-ingest', fn (Request $request) => Limit::perMinute(240)
            ->by('ext:'.self::principalKey($request)));

        // Passkey ceremonies. Starting one parks a challenge in the cache for
        // its TTL, so options are capped per principal (the signed-in user for
        // enrolment, the client for the public sign-in). Verify is a credential
        // check and gets the `credentials` shape: per client, plus per
        // credential + client so a rotating pool cannot grind one passkey —
        // and no credential-wide ceiling, which would let a stranger who knows
        // a credential id lock its owner out.
        RateLimiter::for('webauthn-options', fn (Request $request) => Limit::perMinute(30)
            ->by('webauthn-options:'.self::principalKey($request)));

        RateLimiter::for('webauthn-verify', fn (Request $request) => [
            Limit::perMinute(10)->by('webauthn-verify:'.self::clientKey($request)),
            ...self::perCredentialAndClient($request, Limit::perMinutes(15, 20)),
        ]);

        // The password step-up before a passkey enrolment (B2): an authenticated
        // password oracle, so it gets the `credentials` budget — keyed on the
        // ACCOUNT rather than an email, since here the session is the attacker's
        // handle. Tighter than `webauthn-options`, which it replaces on that route.
        RateLimiter::for('webauthn-stepup', fn (Request $request) => [
            Limit::perMinute(10)->by('ip:'.self::clientKey($request)),
            Limit::perMinutes(15, 20)->by('webauthn-stepup:'.self::principalKey($request)),
        ]);
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

    /** @return array<int, Limit> */
    private static function perEmailAndClient(Request $request, Limit $limit): array
    {
        $email = self::email($request);

        return $email === null ? [] : [$limit->by('email-client:'.sha1($email.'|'.self::clientKey($request)))];
    }

    /** @return array<int, Limit> */
    private static function perCredentialAndClient(Request $request, Limit $limit): array
    {
        $credentialId = $request->input('credential.id');
        if (! is_string($credentialId) || $credentialId === '') {
            return [];
        }

        return [$limit->by('credential-client:'.sha1($credentialId.'|'.self::clientKey($request)))];
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
