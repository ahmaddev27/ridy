<?php

namespace App\Domain\Notifications\Push;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
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

            // A token FCM reports as UNREGISTERED / NotRegistered is permanently
            // dead (app uninstalled, data cleared, or the token rotated). Delete it
            // so it stops failing on every future offer and no longer lingers as a
            // ghost device that "still gets notifications" after a sign-out.
            if ($this->isDeadToken($response->status(), (string) $response->body())) {
                DeviceToken::withoutGlobalScopes()->where('token', $deviceToken)->delete();
            }
        }

        return $response->successful();
    }

    /** FCM's permanent "this token no longer exists" verdict (404 UNREGISTERED). */
    private function isDeadToken(int $status, string $body): bool
    {
        return $status === 404
            && (str_contains($body, 'UNREGISTERED') || str_contains($body, 'NotRegistered'));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function message(string $token, string $title, string $body, array $data): array
    {
        // A notification message (title + rich body) so Android reliably renders
        // the full offer — names + pickup/drop-off — even when the app is killed.
        // The offer detail also rides in `data` for tap routing. NOTE: a data-only
        // message (to get the on-notification "Open in map" action button) does NOT
        // present reliably on Android and dropped the body on real devices, so we
        // keep the notification message; the map lives inside the offer detail.
        // iOS still shows the action button via aps.category.
        $aps = ['sound' => 'default', 'content-available' => 1];
        if (! empty($data['categoryId'])) {
            $aps['category'] = (string) $data['categoryId'];
        }

        // App-icon badge count (unread offers). iOS sets it straight from the aps
        // payload; Android carries it as notification_count for launchers that show
        // a numbered badge. Only when the caller supplied a numeric value.
        $badge = isset($data['badge']) && is_numeric($data['badge']) ? (int) $data['badge'] : null;
        if ($badge !== null) {
            $aps['badge'] = $badge;
        }

        $androidNotification = ['channel_id' => 'offers', 'sound' => 'default'];
        if ($badge !== null) {
            $androidNotification['notification_count'] = $badge;
        }

        return [
            'token' => $token,
            'notification' => ['title' => $title, 'body' => $body],
            'data' => array_map('strval', $data),
            'android' => [
                'priority' => 'high',
                'notification' => $androidNotification,
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
