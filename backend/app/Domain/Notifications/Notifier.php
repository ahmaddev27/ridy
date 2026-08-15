<?php

namespace App\Domain\Notifications;

use App\Models\User;
use Illuminate\Support\Collection;

/**
 * The one place bell notifications are created. Resolves each event to the right
 * set of recipient users (a tenant's managers, the super-admins, or one user)
 * and stores a typed {@see AppNotification}. `dedupe` skips a user who already
 * has an unread notification of the same type — so recurring conditions
 * (session-needs-relink, subscription-expiring) don't spam the bell.
 */
class Notifier
{
    /** All managers of a company. */
    public function toTenant(int $tenantId, string $type, array $params = [], ?string $href = null, bool $dedupe = false): void
    {
        $this->dispatch(User::where('tenant_id', $tenantId)->get(), $type, $params, $href, $dedupe);
    }

    /** Every super-admin (platform-level events). */
    public function toAdmins(string $type, array $params = [], ?string $href = null, bool $dedupe = false): void
    {
        $this->dispatch(User::role('super_admin')->get(), $type, $params, $href, $dedupe);
    }

    /** One specific user (e.g. the reseller who issued a code). */
    public function toUser(?User $user, string $type, array $params = [], ?string $href = null, bool $dedupe = false): void
    {
        if ($user !== null) {
            $this->dispatch(collect([$user]), $type, $params, $href, $dedupe);
        }
    }

    /**
     * @param  Collection<int, User>  $users
     * @param  array<string, mixed>  $params
     */
    private function dispatch(Collection $users, string $type, array $params, ?string $href, bool $dedupe): void
    {
        foreach ($users as $user) {
            if ($dedupe && $this->hasUnread($user, $type)) {
                continue;
            }
            $user->notify(new AppNotification($type, $params, $href));
        }
    }

    private function hasUnread(User $user, string $type): bool
    {
        return $user->unreadNotifications()->where('data->type', $type)->exists();
    }
}
