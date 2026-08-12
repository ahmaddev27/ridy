<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
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
