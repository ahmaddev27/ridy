<?php

namespace App\Domain\Notifications;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Best-effort real-time broadcast (Reverb) that can never break its caller.
 *
 * `rescue(fn () => broadcast(...))` does NOT protect: broadcast() returns a
 * PendingBroadcast that sends in its DESTRUCTOR, which runs after rescue() has
 * returned — a slow or down Reverb (1 s client timeout) then threw out of offer
 * transitions and the daemon's status batch. Here the pending broadcast is
 * released INSIDE the try, and failures are logged at most once a minute.
 */
final class SafeBroadcast
{
    private const LOG_THROTTLE_KEY = 'safe_broadcast.failed';

    /** @param array<string, mixed> $context extra log context (ids only, no personal data) */
    public static function send(object $event, array $context = []): void
    {
        try {
            $pending = broadcast($event);
            unset($pending);
        } catch (Throwable $e) {
            self::logThrottled($event, $context, $e);
        }
    }

    /** @param array<string, mixed> $context */
    private static function logThrottled(object $event, array $context, Throwable $e): void
    {
        try {
            if (Cache::add(self::LOG_THROTTLE_KEY, 1, 60)) {
                Log::warning('broadcast.failed', $context + ['event' => $event::class, 'error' => $e->getMessage()]);
            }
        } catch (Throwable) {
            // The cache is down too — logging must never break the caller either.
        }
    }
}
