<?php

namespace App\Domain\Notifications\Push;

use App\Domain\Notifications\Contracts\PushSender;
use Illuminate\Support\Facades\Log;

/**
 * Default sender used until real FCM credentials are configured. Writes the push
 * to the log so the flow is fully exercisable without a Firebase project.
 */
class LogPushSender implements PushSender
{
    public function send(string $deviceToken, string $title, string $body, array $data = []): bool
    {
        Log::info('push.send', [
            'token' => substr($deviceToken, 0, 12).'…',
            'title' => $title,
            'body' => $body,
            'data' => $data,
        ]);

        return true;
    }
}
