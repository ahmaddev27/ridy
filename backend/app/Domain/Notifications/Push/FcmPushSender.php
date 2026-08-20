<?php

namespace App\Domain\Notifications\Push;

use App\Domain\Notifications\Contracts\PushSender;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Firebase Cloud Messaging sender (HTTP v1, OAuth2 service-account).
 *
 * Dispatch offers are time-critical (a ~5s accept window), so every message is
 * sent at the highest priority with a data payload — this wakes the app even
 * when backgrounded or closed, and lets the app render its own countdown UI
 * rather than a plain notification.
 */
class FcmPushSender implements PushSender
{
    public function __construct(
        private readonly GoogleServiceAccountToken $auth,
        private readonly string $projectId,
    ) {}

    public function send(string $deviceToken, string $title, string $body, array $data = []): bool
    {
        try {
            $response = Http::withToken($this->auth->accessToken())
                ->acceptJson()
                ->timeout(5) // a hung FCM endpoint must never stall the ingest hot path
                ->post($this->endpoint(), [
                    'message' => $this->message($deviceToken, $title, $body, $data),
                ]);
        } catch (Throwable $e) {
            Log::warning('push.fcm_error', ['message' => $e->getMessage()]);

            return false;
        }

        if (! $response->successful()) {
            Log::warning('push.fcm_failed', ['status' => $response->status(), 'body' => $response->body()]);
        }

        return $response->successful();
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function message(string $token, string $title, string $body, array $data): array
    {
        // A notification message (title/body + high-priority channel) so Android
        // reliably renders the rich offer push — with the pickup→drop-off body —
        // even when the app is killed. The full offer detail also rides in `data`
        // so a tap can route to the offer. (A data-only message would enable the
        // notification action button but doesn't reliably display when killed on
        // Android, which risks a missed, time-critical offer — not worth it.)
        $aps = ['sound' => 'default', 'content-available' => 1];

        // iOS surfaces action buttons by matching aps.category to a registered one.
        if (! empty($data['categoryId'])) {
            $aps['category'] = (string) $data['categoryId'];
        }

        return [
            'token' => $token,
            'notification' => ['title' => $title, 'body' => $body],
            'data' => array_map('strval', $data),
            'android' => [
                'priority' => 'high',
                'notification' => ['channel_id' => 'offers', 'sound' => 'default'],
            ],
            'apns' => [
                'headers' => ['apns-priority' => '10'],
                'payload' => ['aps' => $aps],
            ],
        ];
    }

    private function endpoint(): string
    {
        return "https://fcm.googleapis.com/v1/projects/{$this->projectId}/messages:send";
    }
}
