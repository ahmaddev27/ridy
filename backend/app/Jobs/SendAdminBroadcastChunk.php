<?php

namespace App\Jobs;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Contracts\SendsPushInBulk;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\Notifier;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * One bounded slice of an admin broadcast ({@see SendAdminBroadcast}): a bell
 * entry + push (+ email) per user, or a push per driver device. Idempotent per
 * broadcast: users whose bell entry already carries this broadcast_id are
 * skipped, so a retry after a timeout never notifies anyone twice.
 */
class SendAdminBroadcastChunk implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $backoff = 30;

    /** Below the worker's retry_after; a slow SMTP chunk fails instead of hanging. */
    public int $timeout = 50;

    public bool $failOnTimeout = true;

    /**
     * @param  array<int, int>  $userIds
     * @param  array<int, int>  $driverIds
     */
    public function __construct(
        public readonly string $broadcastId,
        private readonly string $title,
        private readonly string $body,
        private readonly ?string $href,
        public readonly array $userIds,
        public readonly array $driverIds,
    ) {}

    public function handle(Notifier $notifier, PushSender $sender): void
    {
        $this->notifyUsers($notifier);
        $this->pushDrivers($sender);
    }

    private function notifyUsers(Notifier $notifier): void
    {
        if ($this->userIds === []) {
            return;
        }

        $params = ['title' => $this->title, 'body' => $this->body, 'broadcast_id' => $this->broadcastId];
        $done = $this->alreadyNotified();

        User::whereIn('id', $this->userIds)->whereNotIn('id', $done)->get()
            ->each(function (User $user) use ($notifier, $params): void {
                try {
                    $notifier->toUser($user, 'admin_broadcast', $params, $this->href);
                } catch (Throwable) {
                    // One dead push token or transient failure must never abort the batch.
                }
            });
    }

    /**
     * Users of this chunk who already hold this broadcast's bell entry (a retry).
     *
     * @return array<int, int>
     */
    private function alreadyNotified(): array
    {
        return DB::table('notifications')
            ->where('notifiable_type', (new User)->getMorphClass())
            ->whereIn('notifiable_id', $this->userIds)
            ->where('data', 'like', '%'.$this->broadcastId.'%')
            ->pluck('notifiable_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /** Drivers get a straight FCM push (the driver app has no bell inbox). */
    private function pushDrivers(PushSender $sender): void
    {
        if ($this->driverIds === []) {
            return;
        }

        $tokens = DeviceToken::withoutGlobalScopes()->whereIn('driver_id', $this->driverIds)->pluck('token')->all();
        if ($tokens === []) {
            return;
        }

        $data = ['type' => 'admin_broadcast', 'href' => (string) ($this->href ?? '')];

        if ($sender instanceof SendsPushInBulk) {
            rescue(fn () => $sender->sendMany($tokens, $this->title, $this->body, $data), report: false);

            return;
        }

        foreach ($tokens as $token) {
            try {
                $sender->send($token, $this->title, $this->body, $data);
            } catch (Throwable) {
                // A dead token must never abort the batch.
            }
        }
    }
}
