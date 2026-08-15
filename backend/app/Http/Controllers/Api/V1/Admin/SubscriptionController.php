<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Super-admin control over company subscriptions: generate a short-lived
 * activation code the owner enters, review companies locked out after too many
 * wrong codes, and reactivate them.
 */
class SubscriptionController extends Controller
{
    use GeneratesOtp;

    private const CODE_TTL_MINUTES = 10;

    /**
     * Generate a plan-based activation code the owner enters. Price + duration
     * come from the plan; "paid" is optional (admin may comp a subscription).
     */
    public function generate(Request $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validate([
            'plan_id' => ['required', 'integer'],
            'paid' => ['boolean'],
        ]);

        $plan = Plan::where('active', true)->find($data['plan_id']);
        if ($plan === null) {
            throw ValidationException::withMessages(['plan_id' => 'plan_unavailable']);
        }

        $paid = (bool) ($data['paid'] ?? false);
        $code = $this->newOtp();
        $expiresAt = CarbonImmutable::now()->addMinutes(self::CODE_TTL_MINUTES);

        $tenant->forceFill([
            'activation_code' => $code,
            'activation_code_expires_at' => $expiresAt,
            'activation_days' => $plan->duration_days,
            'activation_amount' => $plan->price,
            'activation_paid' => $paid,
            'activation_collector_id' => null, // admin-issued, no reseller
            'activation_attempts' => 0,
        ])->save();

        SubscriptionCode::create([
            'code' => $code,
            'plan_id' => $plan->id,
            'tenant_id' => $tenant->id,
            'collector_id' => null,
            'amount' => $plan->price,
            'paid' => $paid,
            'expires_at' => $expiresAt,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['data' => [
            'code' => $code,
            'plan' => $plan->name,
            'days' => $plan->duration_days,
            'price' => (float) $plan->price,
            'paid' => $paid,
            'expires_at' => $expiresAt->toIso8601String(),
        ]]);
    }

    /**
     * Grant a company a free subscription for N days — activates it exactly like a
     * paid one (dashboard + driver app), but with no code and no invoice. Extends
     * an existing active subscription instead of shortening it.
     */
    public function grantFree(Request $request, Tenant $tenant, Notifier $notifier): JsonResponse
    {
        $data = $request->validate([
            'days' => ['required', 'integer', 'min:1', 'max:3650'],
        ]);

        $now = CarbonImmutable::now();
        $base = $tenant->subscription_ends_at !== null && $tenant->subscription_ends_at->isAfter($now)
            ? CarbonImmutable::parse($tenant->subscription_ends_at)
            : $now;
        $endsAt = $base->addDays($data['days']);

        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activated_at' => $tenant->activated_at ?? $now,
            'subscription_ends_at' => $endsAt,
            'activation_attempts' => 0,
        ])->save();

        // Place it on a proxy from the pool, same as a real activation.
        app(ProxyPool::class)->assign($tenant);

        $notifier->toTenant($tenant->id, 'subscription_free', ['days' => $data['days']], '/mySubscription');

        return response()->json(['data' => [
            'free' => true,
            'days' => $data['days'],
            'subscription_ends_at' => $endsAt->toDateString(),
            'days_left' => $tenant->fresh()->daysLeft(),
        ]]);
    }

    /** Companies locked out after 3 wrong activation codes — with owner phones. */
    public function banned(): JsonResponse
    {
        $tenants = Tenant::whereNotNull('banned_at')->orderByDesc('banned_at')->get();

        $owners = User::whereIn('tenant_id', $tenants->pluck('id'))
            ->orderBy('id')->get()->groupBy('tenant_id');

        $rows = $tenants->map(function (Tenant $t) use ($owners) {
            $owner = $owners->get($t->id)?->first();

            return [
                'id' => $t->id,
                'name' => $t->name,
                'banned_at' => $t->banned_at?->toIso8601String(),
                'owner_name' => $owner?->name,
                'owner_email' => $owner?->email,
                'owner_phone' => $owner?->phone,
            ];
        });

        return response()->json(['data' => $rows]);
    }

    /** Lift a ban and reactivate the account (admin does this after contact). */
    public function reactivate(Tenant $tenant): JsonResponse
    {
        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activation_attempts' => 0,
            'activation_code' => null,
            'activation_code_expires_at' => null,
        ])->save();

        app(ProxyPool::class)->assign($tenant);

        return response()->json(['data' => ['reactivated' => true]]);
    }
}
