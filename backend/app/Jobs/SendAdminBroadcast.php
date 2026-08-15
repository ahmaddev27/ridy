<?php

namespace App\Jobs;

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
     */
    public function __construct(
        private readonly array $userIds,
        private readonly string $title,
        private readonly string $body,
        private readonly ?string $href = null,
    ) {}

    public function handle(Notifier $notifier): void
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
    }
}
