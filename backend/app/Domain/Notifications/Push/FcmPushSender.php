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
        // DATA-ONLY (no top-level `notification`): with a notification block Android
        // renders the push in the system tray itself when the app is killed, which
        // strips expo's category — so the "Open in map" action button never shows.
        // Sending data-only lets expo-notifications present it (the app registered
        // the "offer" category), which surfaces the action button and routes a tap.
        // expo builds the Android notification from these data keys.
        $payload = array_merge([
            'title' => $title,
            'body' => $body,
            'channelId' => 'offers',
            'sound' => 'default',
        ], array_map('strval', $data));

        // iOS still needs an explicit alert to display; aps.category shows the button.
        $aps = [
            'alert' => ['title' => $title, 'body' => $body],
            'sound' => 'default',
            'content-available' => 1,
        ];
        if (! empty($data['categoryId'])) {
            $aps['category'] = (string) $data['categoryId'];
        }

        return [
            'token' => $token,
            'data' => $payload,
            'android' => ['priority' => 'high'],
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
