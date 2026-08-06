<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;

/**
 * Test/inspection logger. Writes every piece of data pulled from Uber to the
 * dedicated `ridy` channel (storage/logs/ridy.log) as clearly formatted JSON,
 * so the full payload is easy to read while testing.
 */
class RidyLog
{
    public static function event(string $event, array $data): void
    {
        $json = json_encode(
            ['event' => $event, 'at' => now()->toIso8601String(), 'data' => $data],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        );

        // A leading newline + separator keeps consecutive entries readable.
        Log::channel('ridy')->debug("\n===== {$event} =====\n{$json}");
    }
}
