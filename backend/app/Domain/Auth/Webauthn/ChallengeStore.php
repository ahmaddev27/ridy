<?php

namespace App\Domain\Auth\Webauthn;

use Illuminate\Contracts\Cache\LockProvider;
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
 *
 * "Exactly once" has to hold across processes too: the cache's own `pull` is a
 * read followed by a delete, so two answers racing on the database store could
 * both read before either deletes. The read-and-delete therefore runs under a
 * per-ceremony atomic lock, and a second answer that finds the lock taken is
 * refused outright — the honest client only ever answers once.
 */
class ChallengeStore
{
    private const KEY_PREFIX = 'webauthn:ceremony:';

    /** Longer than any read-and-delete, far shorter than a ceremony. */
    private const LOCK_SECONDS = 5;

    public function __construct(private readonly Cache $cache) {}

    /** Stores the options JSON and returns the ceremony id the client must echo. */
    public function put(string $optionsJson): string
    {
        $ceremonyId = (string) Str::uuid();

        $this->cache->put(self::KEY_PREFIX.$ceremonyId, $optionsJson, $this->ttlSeconds());

        return $ceremonyId;
    }

    /** The options JSON, once — null when unknown, expired, already answered or being answered right now. */
    public function pull(string $ceremonyId): ?string
    {
        $key = self::KEY_PREFIX.$ceremonyId;
        $store = $this->cache->getStore();

        if (! $store instanceof LockProvider) {
            // No atomic primitive on this store (none of ours): plain pull.
            $json = $this->cache->pull($key);

            return is_string($json) ? $json : null;
        }

        // Non-blocking: a concurrent answer to the same ceremony IS the replay
        // this guards against, so the loser gets "gone", not a turn.
        $json = $store->lock($key.':lock', self::LOCK_SECONDS)->get(fn () => $this->cache->pull($key));

        return is_string($json) ? $json : null;
    }

    private function ttlSeconds(): int
    {
        return max(1, (int) config('webauthn.challenge_ttl', 120));
    }
}
