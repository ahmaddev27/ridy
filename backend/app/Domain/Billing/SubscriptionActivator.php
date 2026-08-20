<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
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

    /**
     * Redeem the test code as a real monthly subscription: resolve the monthly
     * plan, write a matching ledger entry (so the history row shows the plan and
     * an "activated" status like a genuine purchase), then apply it — stacking
     * after any remaining time. Returns the created period.
     */
    public function applyTestMonthly(Tenant $tenant, string $code, ?int $createdBy): SubscriptionPeriod
    {
        $plan = $this->monthlyPlan();
        $days = $plan?->duration_days ?? 30;
        $amount = $plan?->price;

        // A ledger row the apply() call then marks activated and links to the
        // period, so the Subscription page shows the plan, amount and status.
        SubscriptionCode::create([
            'code' => $code,
            'plan_id' => $plan?->id,
            'tenant_id' => $tenant->id,
            'collector_id' => null,
            'amount' => $amount,
            'paid' => true,
            'expires_at' => CarbonImmutable::now()->addMinutes(10),
            'created_by' => $createdBy,
        ]);

        return $this->apply($tenant, $days, $amount, true, null, $code);
    }

    /** The monthly plan: an active ~30-day plan, else the shortest active plan. */
    private function monthlyPlan(): ?Plan
    {
        return Plan::query()->where('active', true)
            ->whereBetween('duration_days', [28, 31])
            ->orderBy('duration_days')
            ->first()
            ?? Plan::query()->where('active', true)->orderBy('duration_days')->first();
    }
}
