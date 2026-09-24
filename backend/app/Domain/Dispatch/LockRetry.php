<?php

namespace App\Domain\Dispatch;

use Illuminate\Database\QueryException;

/**
 * Retry a DB mutation on a transient lock error. Status polls, the stale sweeps
 * and new-offer ingest all update the same dispatch_offers rows, so a deadlock
 * (1213) or lock-wait timeout (1205) is an expected, self-healing race — not a bug.
 */
final class LockRetry
{
    /**
     * Run $fn, retrying up to $attempts times on a lock error with a brief growing
     * backoff. Rethrows the last lock error, and any non-lock error immediately.
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    public static function run(callable $fn, int $attempts = 3, int $backoffMicros = 50_000): mixed
    {
        for ($i = 1; ; $i++) {
            try {
                return $fn();
            } catch (QueryException $e) {
                if ($i >= $attempts || ! self::isLockError($e)) {
                    throw $e;
                }
                usleep($backoffMicros * $i);
            }
        }
    }

    /** MySQL 1213 = deadlock, 1205 = lock wait timeout — both worth retrying. */
    public static function isLockError(QueryException $e): bool
    {
        return in_array((int) ($e->errorInfo[1] ?? 0), [1213, 1205], true);
    }
}
