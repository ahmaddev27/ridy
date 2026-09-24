<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Test/inspection logger. `event()` writes data pulled from Uber to the dedicated
 * `ridy` channel (storage/logs/ridy.log) as readable JSON while testing.
 *
 * `event()` is disabled unless APP_DEBUG is on, so production never writes captured
 * cookies to disk (a security risk) and a non-writable log dir can never 500 a
 * request. Error paths must use `failure()` instead, which always reaches the
 * default log channel (and Sentry) — an `event()` in a catch block is invisible
 * in production.
 */
class RidyLog
{
    public static function event(string $event, array $data): void
    {
        if (! config('app.debug')) {
            return;
        }

        try {
            $json = json_encode(
                ['event' => $event, 'at' => now()->toIso8601String(), 'data' => $data],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
            );

            Log::channel('ridy')->debug("\n===== {$event} =====\n{$json}");
        } catch (Throwable $e) {
            // Logging must never break the request it is observing.
        }
    }

    /**
     * Record a failure in production: a warning on the default channel plus, when
     * an exception is given, a report() to the exception handler (Sentry).
     *
     * Pass non-sensitive context only — ids and the error message, never cookies,
     * tokens or raw Uber payloads.
     *
     * @param  array<string, mixed>  $context
     */
    public static function failure(string $event, array $context = [], ?Throwable $e = null): void
    {
        try {
            if ($e !== null) {
                $context['error'] ??= $e->getMessage();
            }
            Log::warning($event, $context);

            if ($e !== null) {
                report($e);
            }
        } catch (Throwable) {
            // Logging must never break the request it is observing.
        }
    }
}
