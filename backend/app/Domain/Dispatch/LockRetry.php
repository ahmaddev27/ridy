<?php

namespace App\Domain\Dispatch;

use Illuminate\Database\DetectsConcurrencyErrors;
use Illuminate\Database\DetectsLostConnections;
use Illuminate\Database\QueryException;
use Throwable;

/**
 * Retry a DB mutation on a transient lock error. Status polls, the stale sweeps
 * and new-offer ingest all update the same dispatch_offers rows, so a deadlock
 * (1213) or lock-wait timeout (1205) is an expected, self-healing race — not a bug.
 */
final class LockRetry
{
    use DetectsConcurrencyErrors, DetectsLostConnections;

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

    /**
     * A database failure that a retry of the same request can succeed on: a lost or
     * refused connection, too many connections, a deadlock / lock-wait timeout (also
     * when writing a queued job). Anything else — bad data, a constraint, a code bug —
     * fails identically on every retry and must not be retried.
     */
    public static function isTransient(Throwable $e): bool
    {
        if ($e instanceof QueryException && self::isLockError($e)) {
            return true;
        }

        $detector = new self;

        return $detector->causedByLostConnection($e) || $detector->causedByConcurrencyError($e);
    }
}
