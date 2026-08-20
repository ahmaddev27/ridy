<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\ProxyPool;
use App\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Applies a validated subscription (from an activation code) to a tenant. Shared
 * by the public first-time/renew activation and the in-dashboard "redeem code"
 * flow so both behave identically.
 *
 * Renewals **stack**: if the tenant still has time left, the new period starts
 * when the current one ends (not now), so redeeming early never loses days.
 */
class SubscriptionActivator
{
    public function __construct(private Notifier $notifier, private ProxyPool $proxies) {}

    /**
     * Grant `$days` to the tenant, stacking after any remaining time, record the
     * period, close the code's ledger entry, ensure a proxy, and notify. Returns
     * the created period.
     */
    public function apply(
        Tenant $tenant,
        int $days,
        float|string|null $amount,
        bool $paid,
        ?int $soldBy,
        ?string $usedCode,
    ): SubscriptionPeriod {
        $now = CarbonImmutable::now();
        $current = $tenant->subscription_ends_at ? CarbonImmutable::parse($tenant->subscription_ends_at) : null;
        $startsAt = ($current && $current->isFuture()) ? $current : $now;
        $endsAt = $startsAt->addDays(max(1, $days));

        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activated_at' => $tenant->activated_at ?? $now,
            'subscription_ends_at' => $endsAt,
            'activation_code' => null,
            'activation_code_expires_at' => null,
            'activation_days' => null,
            'activation_amount' => null,
            'activation_paid' => false,
            'activation_collector_id' => null,
            'activation_attempts' => 0,
        ])->save();

        $period = SubscriptionPeriod::create([
            'tenant_id' => $tenant->id,
            'days' => $days,
            'amount' => $amount,
            'paid_at' => $paid ? $now : null,
            'sold_by_collector_id' => $soldBy,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
        ]);

        $ledgerEntry = $usedCode === null ? null : SubscriptionCode::where('tenant_id', $tenant->id)
            ->where('code', $usedCode)
            ->whereNull('activated_at')
            ->latest('id')
            ->first();
        $ledgerEntry?->forceFill([
            'activated_at' => $now,
            'subscription_period_id' => $period->id,
        ])->save();

        $this->proxies->assign($tenant);

        $this->notifier->toTenant($tenant->id, 'subscription_activated', ['days' => $days], '/subscription');
        $reseller = $ledgerEntry?->collector()->with('user')->first()?->user;
        if ($reseller !== null && $usedCode !== null) {
            $this->notifier->toUser($reseller, 'code_activated', ['company' => $tenant->name, 'code' => $usedCode], '/reseller');
        }

        return $period;
    }
}
