<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\Plan;
use App\Domain\Collections\Models\Collector;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Reseller surface: a collector with a login issues activation codes for a
 * company against a fixed plan. Price and duration come from the plan, never
 * free-typed, and the resulting invoice is tagged with the reseller who sold it.
 */
class ResellerController extends Controller
{
    use GeneratesOtp;

    private const CODE_TTL_MINUTES = 2;

    /** The active plans a reseller may sell. */
    public function plans(): JsonResponse
    {
        $plans = Plan::where('active', true)->orderBy('price')->get()
            ->map(fn (Plan $p) => ['id' => $p->id, 'name' => $p->name, 'price' => (float) $p->price, 'duration_days' => $p->duration_days]);

        return response()->json(['data' => $plans]);
    }

    /** Search companies by name or owner phone (min 2 chars). */
    public function searchCompanies(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 2) {
            return response()->json(['data' => []]);
        }

        $ids = Tenant::query()->where('name', 'like', "%{$q}%")->limit(20)->pluck('id')
            ->merge(User::query()->where('phone', 'like', "%{$q}%")->whereNotNull('tenant_id')->pluck('tenant_id'))
            ->unique()
            ->take(15);

        $companies = Tenant::query()->whereIn('id', $ids)->orderBy('name')->get(['id', 'name'])
            ->map(fn (Tenant $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'phone' => User::query()->where('tenant_id', $t->id)->whereNotNull('phone')->value('phone'),
            ]);

        return response()->json(['data' => $companies]);
    }

    /** Issue an activation code for a company on a plan. */
    public function generate(Request $request): JsonResponse
    {
        abort_unless($request->user()->can('codes.generate'), 403);

        $collector = Collector::where('user_id', $request->user()->id)->first();
        if ($collector === null) {
            throw ValidationException::withMessages(['collector' => 'not_a_reseller']);
        }

        $data = $request->validate([
            'tenant_id' => ['required', 'integer', 'exists:tenants,id'],
            'plan_id' => ['required', 'integer'],
        ]);

        $plan = Plan::where('active', true)->find($data['plan_id']);
        if ($plan === null) {
            throw ValidationException::withMessages(['plan_id' => 'plan_unavailable']);
        }

        $tenant = Tenant::findOrFail($data['tenant_id']);
        if ($tenant->banned_at !== null) {
            throw ValidationException::withMessages(['tenant_id' => 'company_banned']);
        }

        $code = $this->newOtp();
        $tenant->forceFill([
            'activation_code' => $code,
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(self::CODE_TTL_MINUTES),
            'activation_days' => $plan->duration_days,
            'activation_amount' => $plan->price,
            'activation_paid' => false,
            'activation_collector_id' => $collector->id,
            'activation_attempts' => 0,
        ])->save();

        return response()->json(['data' => [
            'code' => $code,
            'company' => $tenant->name,
            'plan' => $plan->name,
            'days' => $plan->duration_days,
            'price' => (float) $plan->price,
            'expires_at' => $tenant->activation_code_expires_at->toIso8601String(),
        ]]);
    }
}
