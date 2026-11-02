<?php

namespace App\Domain\Dispatch;

use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Mints the short-lived co-browse ticket (docs/28 §2.3) that uber-auth's stream listener
 * verifies: `base64url(JSON) . "." . base64url(HMAC_SHA256(key, base64url(JSON)))` with
 * `key = HMAC_SHA256(UBER_AUTH_SECRET, "cobrowse-v1")`.
 *
 * The ticket never carries the login_id - only `lh`, a 16-hex-char prefix of its sha256 -
 * and no cookie or other secret. It is single-use (jti) and expires 60 s after minting.
 */
class CobrowseTicketSigner
{
    public const TTL = 60;

    private const DOMAIN = 'cobrowse-v1';

    /**
     * @return array{ticket: string, sid: string, expires_at: int}
     */
    public function mint(string $tenantId, string $loginId, ?int $userId = null, ?int $now = null): array
    {
        $exp = ($now ?? CarbonImmutable::now()->getTimestamp()) + self::TTL;
        $sid = (string) Str::uuid();
        $payload = ['tid' => $tenantId, 'sid' => $sid, 'lh' => self::loginHash($loginId)]
            + ($userId !== null ? ['uid' => $userId] : [])
            + ['jti' => (string) Str::uuid(), 'exp' => $exp];

        $body = $this->b64((string) json_encode($payload, JSON_UNESCAPED_SLASHES));

        return ['ticket' => $body.'.'.$this->sign($body), 'sid' => $sid, 'expires_at' => $exp];
    }

    /**
     * Mirror of uber-auth's check (used by tests). Returns the payload, or null when the
     * signature is wrong, the shape is off or the ticket has expired.
     *
     * @return array<string, mixed>|null
     */
    public function verify(string $ticket, ?int $now = null): ?array
    {
        $parts = explode('.', $ticket);
        if (count($parts) !== 2 || ! hash_equals($this->sign($parts[0]), $parts[1])) {
            return null;
        }
        $payload = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/')), true);
        $now ??= CarbonImmutable::now()->getTimestamp();

        return is_array($payload) && ($payload['exp'] ?? 0) > $now ? $payload : null;
    }

    public static function loginHash(string $loginId): string
    {
        return substr(hash('sha256', $loginId), 0, 16);
    }

    private function sign(string $body): string
    {
        return $this->b64(hash_hmac('sha256', $body, $this->key(), true));
    }

    /** HMAC_SHA256(UBER_AUTH_SECRET, "cobrowse-v1"): a domain-separated key, 32 raw bytes. */
    private function key(): string
    {
        return hash_hmac('sha256', self::DOMAIN, (string) config('services.uber_auth.secret'), true);
    }

    private function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
