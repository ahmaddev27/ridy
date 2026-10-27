<?php

namespace App\Domain\Auth\Webauthn;

use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Str;

/**
 * Parks a ceremony's options between the two halves of a WebAuthn exchange.
 *
 * The engine verifies the browser's answer against the ORIGINAL options
 * object, so the server has to keep it for the minute or two a ceremony takes.
 * It lives in the cache under a random one-time id the client echoes back —
 * no session, no cookie — which is what the driver app's bearer-only flow
 * needs (docs/22 §4.6) and costs the dashboard nothing. `pull` is
 * delete-on-read: a ceremony is answered exactly once, so a captured answer
 * cannot be replayed — the same single-use rule as `OtpGuard::consume()`.
 */
class ChallengeStore
{
    private const KEY_PREFIX = 'webauthn:ceremony:';

    public function __construct(private readonly Cache $cache) {}

    /** Stores the options JSON and returns the ceremony id the client must echo. */
    public function put(string $optionsJson): string
    {
        $ceremonyId = (string) Str::uuid();

        $this->cache->put(self::KEY_PREFIX.$ceremonyId, $optionsJson, $this->ttlSeconds());

        return $ceremonyId;
    }

    /** The options JSON, once — null when unknown, expired or already answered. */
    public function pull(string $ceremonyId): ?string
    {
        $json = $this->cache->pull(self::KEY_PREFIX.$ceremonyId);

        return is_string($json) ? $json : null;
    }

    private function ttlSeconds(): int
    {
        return max(1, (int) config('webauthn.challenge_ttl', 120));
    }
}
