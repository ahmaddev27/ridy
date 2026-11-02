<?php

namespace App\Domain\Dispatch;

use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;

/**
 * The one pending passwordless Uber login per company (docs/27 §3.3), kept in the
 * cache — never the database: it is transient (uber-auth holds the live browser in
 * memory for the same 5 minutes) and a restart should simply forget it.
 *
 * The record carries the uber-auth `login_id` (an internal secret that never leaves
 * the backend) and the lifecycle state. It NEVER carries the one-time code, nor the
 * email or anything derived from it.
 */
class LoginAttemptStore
{
    /** A little shorter than uber-auth's 300 s, so we never hold a dead login_id. */
    public const ATTEMPT_TTL = 290;

    /**
     * While Uber's Arkose puzzle is being solved in the co-browse stream (docs/28 §3.3),
     * the attempt lives up to 10 minutes: an explicit change to docs/27's 290. Once the
     * code is requested the normal ATTEMPT_TTL starts over.
     */
    public const CHALLENGE_TTL = 590;

    /** Attempt `phase` while the puzzle is open. */
    public const PHASE_CHALLENGE = 'challenge';

    /** The "starting" marker must outlive the (up to 90 s) uber-auth start call. */
    public const START_WINDOW = 100;

    /** How long a finished attempt (connected / failed) stays readable for the UI poll. */
    public const RESULT_TTL = 120;

    /** @return array<string, mixed>|null */
    public function get(int $tenantId): ?array
    {
        $record = Cache::get($this->key($tenantId));

        return is_array($record) ? $record : null;
    }

    /** @param  array<string, mixed>  $record */
    public function put(int $tenantId, array $record, int $ttl = self::ATTEMPT_TTL): void
    {
        Cache::put($this->key($tenantId), $record, $ttl);
    }

    public function forget(int $tenantId): void
    {
        Cache::forget($this->key($tenantId));
    }

    /** Serialises start/submit/cancel for one company. */
    public function lock(int $tenantId, int $seconds): Lock
    {
        return Cache::lock("uber_login:lock:{$tenantId}", $seconds);
    }

    private function key(int $tenantId): string
    {
        return "uber_login:attempt:{$tenantId}";
    }
}
