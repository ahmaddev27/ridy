<?php

namespace App\Domain\Notifications\Push;

use App\Domain\Notifications\Contracts\PushSender;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Firebase Cloud Messaging sender (HTTP v1). Active only when a server key is
 * configured; wiring the OAuth2 service-account flow is a drop-in once Ridy has
 * a Firebase project. Kept minimal deliberately — see docs/10-implementation-plan.md.
 */
class FcmPushSender implements PushSender
{
    public function __construct(private string $endpoint, private string $serverKey) {}

    public function send(string $deviceToken, string $title, string $body, array $data = []): bool
    {
        $response = Http::withToken($this->serverKey)
            ->acceptJson()
            ->post($this->endpoint, [
                'message' => [
                    'token' => $deviceToken,
                    'notification' => ['title' => $title, 'body' => $body],
                    'data' => array_map('strval', $data),
                ],
            ]);

        if (! $response->successful()) {
            Log::warning('push.fcm_failed', ['status' => $response->status(), 'body' => $response->body()]);
        }

        return $response->successful();
    }
}
