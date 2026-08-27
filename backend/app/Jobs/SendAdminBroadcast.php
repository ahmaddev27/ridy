<?php

namespace App\Jobs;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\Notifier;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

/**
 * Fans a super-admin's free-form broadcast out to a set of users, off the
 * request cycle. Each recipient gets a bell entry AND (best-effort) an FCM
 * push via the {@see Notifier}. Recipients are processed in chunks so a large
 * audience never loads every User at once, and a failure on one recipient is
 * swallowed so the rest of the batch still receives the message.
 */
class SendAdminBroadcast implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    private const CHUNK = 200;

    /**
     * @param  array<int, int>  $userIds
     * @param  array<int, int>  $driverIds  activated app drivers to push (no bell)
     */
    public function __construct(
        private readonly array $userIds,
        private readonly string $title,
        private readonly string $body,
        private readonly ?string $href = null,
        private readonly array $driverIds = [],
    ) {}

    public function handle(Notifier $notifier, PushSender $sender): void
    {
        $params = ['title' => $this->title, 'body' => $this->body];

        foreach (array_chunk($this->userIds, self::CHUNK) as $chunk) {
            User::whereIn('id', $chunk)->get()->each(function (User $user) use ($notifier, $params): void {
                try {
                    $notifier->toUser($user, 'admin_broadcast', $params, $this->href);
                } catch (Throwable) {
                    // One dead push token or transient failure must never abort the batch.
                }
            });
        }

        // Drivers get a straight FCM push to every device they're signed in on —
        // the driver app has no bell inbox, so there's nothing else to write.
        $data = ['type' => 'admin_broadcast', 'href' => (string) ($this->href ?? '')];
        foreach (array_chunk($this->driverIds, self::CHUNK) as $chunk) {
            DeviceToken::withoutGlobalScopes()->whereIn('driver_id', $chunk)->pluck('token')
                ->each(function (string $token) use ($sender, $data): void {
                    try {
                        $sender->send($token, $this->title, $this->body, $data);
                    } catch (Throwable) {
                        // A dead token must never abort the batch.
                    }
                });
        }
    }
}
