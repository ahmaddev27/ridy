<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Billing\SubscriptionActivator;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * A company's own subscription history — the periods it activated, each with the
 * code that produced it, the plan, the collector who sold it, and its status.
 * Tenant-scoped: a manager only ever sees their own company's records.
 */
class CompanySubscriptionController extends Controller
{
    /**
     * Redeem a subscription code from inside the dashboard (already signed in) —
     * a new period stacks after any remaining time. A test code (OTP_TEST_CODE)
     * grants a default monthly period with no admin-issued plan needed.
     */
    public function redeem(Request $request, SubscriptionActivator $activator): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'digits:6']]);
        $tenant = $request->user()->tenant;
        if ($tenant === null) {
            throw ValidationException::withMessages(['code' => 'activation_no_company']);
        }

        // TEMPORARY test backdoor: OTP_TEST_CODE activates a monthly period even in
        // production (unlike isTestCode, which is prod-guarded). Remove after testing.
        $fixed = config('services.otp_test_code');
        $testCode = filled($fixed) && hash_equals((string) $fixed, $data['code']);
        if (! $testCode) {
            if ($tenant->activation_code === null
                || $tenant->activation_code_expires_at?->isPast()
                || ! hash_equals((string) $tenant->activation_code, $data['code'])) {
                throw ValidationException::withMessages(['code' => 'otp_incorrect']);
            }
        }

        $days = (int) $tenant->activation_days;
        if ($testCode && $days <= 0) {
            $days = CompanyActivationController::TEST_CODE_DAYS;
        }

        $period = $activator->apply(
            $tenant,
            $days,
            $tenant->activation_amount,
            (bool) $tenant->activation_paid,
            $tenant->activation_collector_id,
            $testCode ? null : $tenant->activation_code,
        );

        return response()->json(['data' => [
            'activated' => true,
            'days' => $days,
            'ends_at' => $period->ends_at->toIso8601String(),
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;

        $periods = SubscriptionPeriod::where('tenant_id', $tenantId)
            ->with(['code.plan:id,name', 'code.collector:id,name'])
            ->orderByDesc('starts_at')
            ->orderByDesc('id')
            ->get()
            ->map(function (SubscriptionPeriod $p) {
                $code = $p->code;

                return [
                    'id' => $p->id,
                    'plan' => $code?->plan?->name,
                    'code' => $code?->code,
                    'code_status' => $code?->status(),
                    'collector' => $code?->collector?->name,
                    'amount' => $p->amount !== null ? (float) $p->amount : null,
                    'paid' => $p->isPaid(),
                    'days' => $p->days,
                    'starts_at' => $p->starts_at->toDateString(),
                    'ends_at' => $p->ends_at->toDateString(),
                ];
            });

        return response()->json(['data' => $periods]);
    }
}
