<?php

namespace App\Domain\Notifications;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Contracts\SendsPushInBulk;
use App\Domain\Notifications\Models\DeviceToken;
use Illuminate\Support\Facades\Log;

/**
 * Tell a driver their company decided on something they sent.
 *
 * ## Why this exists at all: the bell row reaches nobody
 *
 * `AppNotification::via()` returns `['database']` and nothing else, so the
 * rejection El-Professor reports is written to the driver's notifiable row and
 * **no push is sent** — measured, not assumed. The driver's app has no endpoint
 * that reads those rows either. Without this class a rejection is something the
 * driver discovers the next time they happen to open the app and scroll, which
 * for "your receipt was refused, send a readable photo" is too late to be of
 * use.
 *
 * The bell row is still written, by the controller, and it stays: it is the
 * record. This is the telling.
 *
 * ## The wording is built HERE, in German, and that is a deliberate exception
 *
 * Everything else in this app renders text from a semantic type in the reader's
 * own language, and `AppNotification`'s own header says so. A push cannot:
 * Firebase delivers a title and a body, already rendered, to a phone whose
 * language this process does not know. The driver's locale is not stored with
 * the device token.
 *
 * So the push carries a short German sentence and the **structured params ride
 * along in `data`** — which is what the app reads when the driver taps it,
 * rendering the full reason in their own language on the submissions screen.
 * The push is the knock on the door; the screen is the message.
 *
 * ## It never fails the caller
 *
 * A decision has already been recorded by the time this runs. A push that
 * cannot go must not roll that back or answer 500 to El-Professor, which would
 * have it retry a decision that was taken. Every failure is logged and
 * swallowed.
 */
class SubmissionDecisionNotifier
{
    /** The app's own channel for this, created in `push.ts`. Default
     *  importance: an offer expires in minutes and has earned the loudest
     *  channel, and a decision that arrives as urgently teaches a driver to
     *  ignore both. */
    public const CHANNEL = 'documents';

    private const BUDGET_SECONDS = 5.0;

    public function __construct(private PushSender $sender) {}

    /**
     * @param  array<string, mixed>  $params  the notification's own params, forwarded verbatim
     * @return int how many devices accepted it
     */
    public function rejected(Driver $driver, array $params): int
    {
        $kind = ($params['kind'] ?? 'note') === 'receipt' ? 'Beleg' : 'Notiz';
        $title = $kind.' abgelehnt';
        $reason = trim((string) ($params['reason_text'] ?? ''));
        $body = $reason !== ''
            ? $reason
            : 'Dein Unternehmen hat '.($kind === 'Beleg' ? 'deinen Beleg' : 'deine Notiz').' abgelehnt.';

        $data = [
            // Read by the app's notification-response handler, which opens the
            // submissions screen — where the reason still is tomorrow.
            'type' => 'elprofessor.submission_rejected',
            'kind' => (string) ($params['kind'] ?? 'note'),
            'external_submission_id' => (string) ($params['external_submission_id'] ?? ''),
            'reason_code' => (string) ($params['reason_code'] ?? ''),
            'channel_id' => self::CHANNEL,
        ];

        $tokens = DeviceToken::withoutGlobalScopes()
            ->where('driver_id', $driver->getKey())
            ->pluck('token')
            ->all();

        if ($tokens === []) {
            return 0;
        }

        try {
            if ($this->sender instanceof SendsPushInBulk) {
                return $this->sender->sendMany($tokens, $title, $body, $data);
            }

            $deadline = microtime(true) + self::BUDGET_SECONDS;
            $sent = 0;
            foreach ($tokens as $i => $token) {
                if ($i > 0 && microtime(true) >= $deadline) {
                    break;
                }
                if ($this->sender->send($token, $title, $body, $data)) {
                    $sent++;
                }
            }

            return $sent;
        } catch (\Throwable $e) {
            // The decision is already recorded. A transport that is down must
            // not turn it into a 500 that El-Professor retries.
            Log::warning('elprofessor.decision_push_failed', [
                'driver' => $driver->getKey(),
                'error' => $e->getMessage(),
            ]);

            return 0;
        }
    }
}
