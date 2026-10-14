<?php

namespace App\Domain\Dispatch;

use Carbon\CarbonImmutable;

/**
 * Reads when Uber's two signed session JWTs expire, from a captured cookie jar.
 *
 * The expiry lives inside the signed payload, so nobody but Uber can extend it;
 * Uber only issues a fresh one to a real logged-in browser. Measured on production:
 * `jwt-session` (RAMEN jar) lives 24h, `sp-jwt-session` (supplier jar) 336h.
 */
class SessionTokenExpiry
{
    public const RAMEN_COOKIE = 'jwt-session';

    public const SUPPLIER_COOKIE = 'sp-jwt-session';

    /**
     * The `exp` claim of a JWT, or null when $token is not one.
     *
     * Deliberately does NOT verify the signature: this reads a claim to schedule a
     * warning, it authenticates nothing. Do not "improve" it by verifying — we hold
     * no key, and a wrong guess here would only hide the warning.
     * Most cookies in a jar (sid, csid, _ga, …) are not JWTs; null is the normal case.
     */
    public static function jwtExpiry(string $token): ?CarbonImmutable
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        // App timezone, not UTC: timestamp columns store the wall-clock of the value's own zone.
        $json = base64_decode(strtr($parts[1], '-_', '+/'), true);
        $claims = $json === false ? null : json_decode($json, true);
        $exp = is_array($claims) ? ($claims['exp'] ?? null) : null;

        return is_numeric($exp) ? CarbonImmutable::createFromTimestamp((int) $exp, config('app.timezone')) : null;
    }

    /**
     * Expiry of the named JWT cookie in a jar of {name, value} cookies.
     *
     * @param  array<int, array<string, mixed>>|null  $jar
     */
    public static function fromJar(?array $jar, string $cookieName): ?CarbonImmutable
    {
        foreach ($jar ?? [] as $cookie) {
            if (is_array($cookie) && ($cookie['name'] ?? null) === $cookieName && is_string($cookie['value'] ?? null)) {
                return self::jwtExpiry($cookie['value']);
            }
        }

        return null;
    }

    /**
     * The columns to write when a jar is stored. The supplier column is only
     * included when a supplier jar was sent, so an older client never nulls a
     * good stored expiry.
     *
     * @param  array<int, array<string, mixed>>  $ramenJar
     * @param  array<int, array<string, mixed>>|null  $supplierJar
     * @return array<string, CarbonImmutable|null>
     */
    public static function columns(array $ramenJar, ?array $supplierJar): array
    {
        $columns = ['session_token_expires_at' => self::fromJar($ramenJar, self::RAMEN_COOKIE)];
        if ($supplierJar !== null && $supplierJar !== []) {
            $columns['supplier_token_expires_at'] = self::fromJar($supplierJar, self::SUPPLIER_COOKIE);
        }

        return $columns;
    }
}
