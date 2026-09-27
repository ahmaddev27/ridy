<?php

namespace App\Domain\Notifications\Push;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Contracts\SendsPushInBulk;
use App\Domain\Notifications\Models\DeviceToken;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
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
class FcmPushSender implements PushSender, SendsPushInBulk
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
            $this->reportFailure($deviceToken, $response);
        }

        return $response->successful();
    }

    /**
     * Send the same message to every device AT ONCE. The offer push runs inside
     * Uber's ~5-second accept window, so N sequential 5 s-timeout calls (a driver's
     * two devices plus every owner phone) could hold the ingest request open far
     * longer than the window itself. Pooled, the whole fan-out costs one timeout.
     *
     * @param  array<int, string>  $deviceTokens
     * @param  array<string, mixed>  $data
     */
    public function sendMany(array $deviceTokens, string $title, string $body, array $data = []): int
    {
        $tokens = array_values(array_unique(array_filter($deviceTokens)));
        if ($tokens === []) {
            return 0;
        }
        if (count($tokens) === 1) {
            return $this->send($tokens[0], $title, $body, $data) ? 1 : 0;
        }

        try {
            // One OAuth mint for the batch (it is cached ~55 min anyway).
            $accessToken = $this->auth->accessToken();

            /** @var array<int, Response> $responses */
            $responses = Http::pool(fn (Pool $pool) => array_map(
                fn (string $token) => $pool->withToken($accessToken)
                    ->acceptJson()
                    ->timeout(5)
                    ->post($this->endpoint(), ['message' => $this->message($token, $title, $body, $data)]),
                $tokens,
            ));
        } catch (Throwable $e) {
            Log::warning('push.fcm_error', ['message' => $e->getMessage()]);

            return 0;
        }

        $sent = 0;
        foreach ($tokens as $i => $token) {
            $response = $responses[$i] ?? null;
            // A pooled entry is a Response OR the exception that request threw.
            if (! $response instanceof Response) {
                Log::warning('push.fcm_error', [
                    'message' => $response instanceof Throwable ? $response->getMessage() : 'no response',
                    'token' => substr($token, 0, 12).'…',
                ]);

                continue;
            }

            if ($response->successful()) {
                $sent++;

                continue;
            }

            $this->reportFailure($token, $response);
        }

        return $sent;
    }

    /** Log a compact failure line and prune a permanently-dead token. */
    private function reportFailure(string $deviceToken, Response $response): void
    {
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

        // No `content-available`: the app declares no remote-notification background
        // mode, so it was a no-op that only muddied APNs' push-type inference.
        $aps = ['sound' => $soundFile];
        if (! empty($data['categoryId'])) {
            $aps['category'] = (string) $data['categoryId'];
        }

        $isOffer = self::isOfferPush($data);
        if ($isOffer) {
            // Driving Focus / Do Not Disturb hold back 'active' pushes until the
            // Focus ends — exactly while the driver is on the road. Time-sensitive
            // breaks through (the app's time-sensitive entitlement ships with the
            // next native build; until then iOS treats it as 'active', no harm).
            $aps['interruption-level'] = 'time-sensitive';
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
        $androidNotification = ['channel_id' => $isMultiStop ? 'multistop' : 'offers', 'sound' => 'default'];
        if ($badge !== null) {
            $androidNotification['notification_count'] = $badge;
        }

        $android = ['priority' => 'high', 'notification' => $androidNotification];
        // Explicit alert type: never left to FCM inference (a background-classed
        // push is capped at priority 5 and throttled by APNs).
        $apnsHeaders = ['apns-priority' => '10', 'apns-push-type' => 'alert'];

        if ($isOffer) {
            // An offer is only actionable for seconds. Without an expiry FCM/APNs
            // store it for weeks and a phone coming out of a tunnel rings for a ride
            // that expired long ago. The collapse key/tag makes one offer's updates
            // (the multi-stop follow-up) replace each other instead of piling up.
            $ttl = self::offerTtlSeconds($data);
            $collapse = 'offer-'.$data['offer_id'];

            $android['ttl'] = $ttl.'s';
            $android['collapse_key'] = $collapse;
            $android['notification']['tag'] = $collapse;
            $apnsHeaders['apns-expiration'] = (string) (time() + $ttl);
            $apnsHeaders['apns-collapse-id'] = $collapse;
        }

        return [
            'token' => $token,
            'notification' => ['title' => $title, 'body' => $body],
            'data' => array_map('strval', $data),
            'android' => $android,
            'apns' => [
                'headers' => $apnsHeaders,
                'payload' => ['aps' => $aps],
            ],
        ];
    }

    /**
     * An offer push (driver or owner copy, first alert or multi-stop follow-up) —
     * as opposed to admin broadcasts, bell notifications and PushDoctor tests,
     * which keep FCM's default delivery window.
     *
     * @param  array<string, mixed>  $data
     */
    private static function isOfferPush(array $data): bool
    {
        return ($data['categoryId'] ?? '') === 'offer' && ! empty($data['offer_id']);
    }

    /**
     * How long an undelivered offer push may wait for the device: the accept window
     * plus a grace for clock skew / slow radio, clamped to 15–120 s (45 s when the
     * window is unknown).
     *
     * @param  array<string, mixed>  $data
     */
    public static function offerTtlSeconds(array $data): int
    {
        $window = (int) ($data['accept_window'] ?? 0);

        return $window > 0 ? max(15, min(120, $window + 30)) : 45;
    }

    private function endpoint(): string
    {
        return "https://fcm.googleapis.com/v1/projects/{$this->projectId}/messages:send";
    }
}
