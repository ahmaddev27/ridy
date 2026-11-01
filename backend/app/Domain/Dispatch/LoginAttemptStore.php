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
 * the backend), a one-way hash of the email for comparison, and the lifecycle state.
 * It NEVER carries the one-time code.
 */
class LoginAttemptStore
{
    /** A little shorter than uber-auth's 300 s, so we never hold a dead login_id. */
    public const ATTEMPT_TTL = 290;

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

    /** Not reversible and not the email: only ever compared, never shown. */
    public function hashEmail(string $email): string
    {
        return hash('sha256', mb_strtolower(trim($email)));
    }

    private function key(int $tenantId): string
    {
        return "uber_login:attempt:{$tenantId}";
    }
}
