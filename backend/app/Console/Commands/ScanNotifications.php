<?php

namespace App\Console\Commands;

use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Emits the time-based notifications that no single request can (subscriptions
 * about to expire / just expired, proxies about to expire). Deduped so it never
 * spams the bell. Schedule it daily.
 */
class ScanNotifications extends Command
{
    protected $signature = 'notifications:scan';

    protected $description = 'Emit subscription/proxy expiry notifications.';

    /** Warn this many days before a subscription/proxy expires. */
    private const SUBSCRIPTION_WARN_DAYS = 3;

    private const PROXY_WARN_DAYS = 5;

    public function handle(Notifier $notifier): int
    {
        $now = CarbonImmutable::now();

        // Subscriptions expiring soon (still active).
        Tenant::query()->usable()
            ->whereNotNull('subscription_ends_at')
            ->whereBetween('subscription_ends_at', [$now, $now->addDays(self::SUBSCRIPTION_WARN_DAYS)])
            ->get()
            ->each(fn (Tenant $t) => $notifier->toTenant($t->id, 'subscription_expiring', ['days' => max(0, $t->daysLeft())], '/mySubscription', dedupe: true));

        // Subscriptions that expired in the last day.
        Tenant::query()
            ->whereNotNull('subscription_ends_at')
            ->whereBetween('subscription_ends_at', [$now->subDay(), $now])
            ->get()
            ->each(fn (Tenant $t) => $notifier->toTenant($t->id, 'subscription_expired', [], '/mySubscription', dedupe: true));

        // Proxies about to expire (admin heads-up).
        Proxy::query()
            ->whereNotNull('expires_at')
            ->whereDate('expires_at', '<=', $now->addDays(self::PROXY_WARN_DAYS)->toDateString())
            ->get()
            ->each(fn (Proxy $p) => $notifier->toAdmins('proxy_expiring', ['label' => $p->label], '/admin/proxies', dedupe: true));

        $this->info('Notification scan complete.');

        return self::SUCCESS;
    }
}
