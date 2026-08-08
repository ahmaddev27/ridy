<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;

/**
 * Test/inspection logger. Writes data pulled from Uber to the dedicated `ridy`
 * channel (storage/logs/ridy.log) as readable JSON while testing.
 *
 * Disabled unless APP_DEBUG is on, so production never writes captured cookies
 * to disk (a security risk) and a non-writable log dir can never 500 a request.
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
        } catch (\Throwable $e) {
            // Logging must never break the request it is observing.
        }
    }
}
