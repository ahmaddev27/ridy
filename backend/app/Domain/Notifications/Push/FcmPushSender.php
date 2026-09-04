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
            $dead = $this->isDeadToken($response->status(), (string) $response->body());

            // Log a COMPACT single line (FCM's error body is pretty-printed multi-line
            // JSON that floods the log) — just the status, the one-line message and the
            // token prefix, plus whether we pruned it.
            Log::warning('push.fcm_failed', [
                'status' => $response->status(),
                'error' => (string) ($response->json('error.message') ?? 'unknown'),
                'token' => substr($deviceToken, 0, 12).'…',
                'pruned' => $dead,
            ]);

            // A permanently-dead token would otherwise fail on every future offer and
            // linger as a ghost device. Delete it so the noise stops.
            if ($dead) {
                DeviceToken::withoutGlobalScopes()->where('token', $deviceToken)->delete();
            }
        }

        return $response->successful();
    }

    /**
     * A token FCM will NEVER deliver to, so we should drop it:
     *  - 404 UNREGISTERED / NotRegistered — existed but is gone (uninstall / rotation).
     *  - 400 INVALID_ARGUMENT "not a valid FCM registration token" — never a real FCM
     *    token (e.g. a raw APNs token stored by an older iOS build).
     */
    private function isDeadToken(int $status, string $body): bool
    {
        if ($status === 404 && (str_contains($body, 'UNREGISTERED') || str_contains($body, 'NotRegistered'))) {
            return true;
        }

        return $status === 400
            && str_contains($body, 'INVALID_ARGUMENT')
            && str_contains($body, 'not a valid FCM registration token');
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
        // A multi-stop alert plays a distinct sound (multi.wav) and rides the urgent
        // "multistop" channel; a routine offer uses normal.wav on "offers". The wavs
        // are bundled in the app (app.json expo-notifications `sounds`) and only ship
        // via a native eas build — an unknown sound name falls back to the default.
        $isMultiStop = isset($data['stops_count']) && (int) $data['stops_count'] >= 2;
        $soundFile = $isMultiStop ? 'multi.wav' : 'normal.wav';

        $aps = ['sound' => $soundFile, 'content-available' => 1];
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

        // A multi-stop alert routes to the app's dedicated "multistop" channel
        // (MAX importance + an urgent vibration pattern) so the extra drop-offs grab
        // the driver's attention, distinct from a routine offer on "offers". The app
        // creates both channels (src/lib/push.ts); an unknown id falls back to the
        // default channel harmlessly. (A custom sound file still needs a native build.)
        $isMultiStop = isset($data['stops_count']) && (int) $data['stops_count'] >= 2;
        $androidNotification = ['channel_id' => $isMultiStop ? 'multistop' : 'offers', 'sound' => 'default'];
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
