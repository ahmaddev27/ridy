<?php

namespace App\Domain\Notifications;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\Models\UserPushToken;
use App\Models\EmailTemplate;
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
    /** Frequent/low-value events that stay in-app only — never emailed. */
    private const EMAIL_SKIP = ['session_connected'];

    /**
     * User-configurable notification categories (the bell is always on; these
     * gate the web-push and email channels). "broadcast" is intentionally absent:
     * admin broadcasts always deliver and are never shown as a toggle.
     */
    public const CATEGORIES = ['sessions', 'subscription', 'platform', 'codes'];

    /** Notification type => preference category. subscription_* handled by prefix. */
    private const TYPE_CATEGORY = [
        'session_connected' => 'sessions',
        'session_needs_relink' => 'sessions',
        'company_registered' => 'platform',
        'company_banned' => 'platform',
        'proxy_expiring' => 'platform',
        'code_activated' => 'codes',
        'admin_broadcast' => 'broadcast',
    ];

    /** Localized label for the email call-to-action button. */
    private const OPEN_LABEL = ['de' => 'Öffnen', 'en' => 'Open', 'ar' => 'فتح'];

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
                // Admin broadcasts always deliver, ignoring user channel prefs.
                $forced = $type === 'admin_broadcast';
                $category = self::categoryFor($type);

                if ($forced || $user->wantsChannel('push', $category)) {
                    $this->webPush($user, $type, $params, $href);
                }
                if ($forced || $user->wantsChannel('email', $category)) {
                    $this->email($user, $type, $params, $href);
                }
            }
        }
    }

    /** Resolve a notification type to its user-facing preference category. */
    public static function categoryFor(string $type): string
    {
        if (str_starts_with($type, 'subscription_')) {
            return 'subscription';
        }

        return self::TYPE_CATEGORY[$type] ?? 'platform';
    }

    /** Also deliver important events by email, in the user's language. */
    private function email(User $user, string $type, array $params, ?string $href): void
    {
        if (in_array($type, self::EMAIL_SKIP, true) || blank($user->email)) {
            return;
        }

        $locale = $user->locale ?: 'de';
        $copy = $this->text->for($type, $params, $locale);
        $base = rtrim((string) config('app.frontend_url', config('app.url')), '/');

        // Prefer a per-event template when one is seeded; else the generic one.
        $key = EmailTemplate::whereKey($type)->exists() ? $type : 'notification';

        try {
            SendTemplatedMail::to($user->email, $key, [
                'title' => $copy['title'],
                'body' => $copy['body'],
                'action_url' => $href ? $base.$href : $base,
                'action_label' => self::OPEN_LABEL[$locale] ?? self::OPEN_LABEL['de'],
            ]);
        } catch (Throwable) {
            // Email is best-effort; a mailer hiccup must never break the bell write.
        }
    }

    /**
     * Best-effort FCM push to every device this user can be reached on: their
     * browser tokens (UserPushToken) AND their mobile owner-app tokens
     * (DeviceToken keyed by user_id) — so a broadcast lands on the dashboard and
     * the phone, not just one of them.
     */
    private function webPush(User $user, string $type, array $params, ?string $href): void
    {
        $tokens = UserPushToken::where('user_id', $user->id)->pluck('token')
            ->merge(DeviceToken::withoutGlobalScopes()->where('user_id', $user->id)->pluck('token'))
            ->unique()
            ->values();
        if ($tokens->isEmpty()) {
            return;
        }

        $copy = $this->text->for($type, $params, $user->locale ?: 'de');
        $data = ['type' => $type, 'href' => (string) ($href ?? '')];

        foreach ($tokens as $token) {
            try {
                $this->sender->send($token, $copy['title'], $copy['body'], $data);
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
