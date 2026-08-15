<?php

namespace App\Domain\Notifications;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\UserPushToken;
use App\Models\User;
use Illuminate\Support\Collection;
use Throwable;

/**
 * The one place bell notifications are created. Resolves each event to the right
 * set of recipient users (a tenant's managers, the super-admins, or one user),
 * stores a typed {@see AppNotification}, and — for dashboard users with a
 * registered browser token — also sends an FCM web push so the alert arrives
 * even when the tab is closed. `dedupe` skips a user who already has an unread
 * notification of the same type. Set `push: false` for high-frequency events
 * (offers) that should live in the bell but never fire an external push.
 */
class Notifier
{
    public function __construct(
        private readonly PushSender $sender,
        private readonly NotificationPushText $text,
    ) {}

    /** All managers of a company. */
    public function toTenant(int $tenantId, string $type, array $params = [], ?string $href = null, bool $dedupe = false, bool $push = true): void
    {
        $this->dispatch(User::where('tenant_id', $tenantId)->get(), $type, $params, $href, $dedupe, $push);
    }

    /** Every super-admin (platform-level events). */
    public function toAdmins(string $type, array $params = [], ?string $href = null, bool $dedupe = false, bool $push = true): void
    {
        $this->dispatch(User::role('super_admin')->get(), $type, $params, $href, $dedupe, $push);
    }

    /** One specific user (e.g. the reseller who issued a code). */
    public function toUser(?User $user, string $type, array $params = [], ?string $href = null, bool $dedupe = false, bool $push = true): void
    {
        if ($user !== null) {
            $this->dispatch(collect([$user]), $type, $params, $href, $dedupe, $push);
        }
    }

    /**
     * @param  Collection<int, User>  $users
     * @param  array<string, mixed>  $params
     */
    private function dispatch(Collection $users, string $type, array $params, ?string $href, bool $dedupe, bool $push): void
    {
        foreach ($users as $user) {
            if ($dedupe && $this->hasUnread($user, $type)) {
                continue;
            }
            $user->notify(new AppNotification($type, $params, $href));

            if ($push) {
                $this->webPush($user, $type, $params, $href);
            }
        }
    }

    /** Best-effort FCM web push to each of the user's browser tokens. */
    private function webPush(User $user, string $type, array $params, ?string $href): void
    {
        $tokens = UserPushToken::where('user_id', $user->id)->get();
        if ($tokens->isEmpty()) {
            return;
        }

        $copy = $this->text->for($type, $params, $user->locale ?: 'de');
        $data = ['type' => $type, 'href' => (string) ($href ?? '')];

        foreach ($tokens as $token) {
            try {
                $this->sender->send($token->token, $copy['title'], $copy['body'], $data);
            } catch (Throwable) {
                // A dead token or transport hiccup must never break the bell write.
            }
        }
    }

    private function hasUnread(User $user, string $type): bool
    {
        return $user->unreadNotifications()->where('data->type', $type)->exists();
    }
}
