<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Billing\PaymentClaimService;
use App\Domain\Billing\SubscriptionActivator;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * A company's own subscription history — the periods it activated, each with the
 * code that produced it, the plan, the collector who sold it, and its status.
 * Tenant-scoped: a manager only ever sees their own company's records.
 */
class CompanySubscriptionController extends Controller
{
    use GeneratesOtp;

    /** Wrong codes a company may enter before the redeem form locks. */
    private const REDEEM_MAX_ATTEMPTS = 5;

    /** How long the redeem lockout lasts once tripped (seconds). */
    private const REDEEM_LOCKOUT_SECONDS = 900; // 15 minutes

    /**
     * Redeem a subscription code from inside the dashboard (already signed in) —
     * a new period stacks after any remaining time. The test code (OTP_TEST_CODE)
     * is honoured outside production only, exactly like the public activation.
     * Wrong codes trip a per-company lockout so the 6-digit space can't be walked.
     */
    public function redeem(Request $request, SubscriptionActivator $activator): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'digits:6']]);
        $tenant = $request->user()->tenant;
        if ($tenant === null) {
            throw ValidationException::withMessages(['code' => 'activation_no_company']);
        }

        $throttleKey = 'subscription-redeem:'.$tenant->id;
        if (RateLimiter::tooManyAttempts($throttleKey, self::REDEEM_MAX_ATTEMPTS)) {
            throw ValidationException::withMessages(['code' => 'otp_too_many']);
        }

        // A real admin/reseller-issued code takes priority over the test code, so
        // a generated code that happens to equal OTP_TEST_CODE still links its
        // ledger entry and grants the plan's days (not the test default).
        $realMatch = $activator->isPendingCode($tenant, $data['code']);
        $testCode = ! $realMatch && $this->isTestCode($data['code']);

        if (! $realMatch && ! $testCode) {
            RateLimiter::hit($throttleKey, self::REDEEM_LOCKOUT_SECONDS);
            throw ValidationException::withMessages(['code' => 'otp_incorrect']);
        }

        // A real code is re-checked and consumed under the tenant row lock, so
        // parallel submits of one code yield a single period.
        $period = $testCode
            ? $activator->applyTestMonthly($tenant, $data['code'], $request->user()->id)
            : $activator->redeemIssuedCode($tenant, $data['code']);

        RateLimiter::clear($throttleKey);

        return response()->json(['data' => [
            'activated' => true,
            'days' => $period->days,
            'ends_at' => $period->ends_at->toIso8601String(),
        ]]);
    }

    /** The company's stable payment reference (REIDEY-JAB-4821) + claim state. */
    public function paymentReference(Request $request, PaymentClaimService $claims): JsonResponse
    {
        $tenant = $request->user()->tenant;
        if ($tenant === null) {
            return response()->json(['data' => ['reference' => null, 'claim_pending' => false]]);
        }

        return response()->json(['data' => [
            'reference' => $tenant->ensurePaymentReference(),
            'claim_pending' => $claims->hasPending($tenant),
        ]]);
    }

    /** "I've paid" — open (or return the existing) pending payment claim. */
    public function claim(Request $request, PaymentClaimService $claims): JsonResponse
    {
        $tenant = $request->user()->tenant;
        if ($tenant === null) {
            throw ValidationException::withMessages(['tenant' => 'activation_no_company']);
        }

        $result = $claims->open($tenant);

        return response()->json(['data' => [
            'pending' => true,
            'created' => $result['created'],
            'reference' => $result['claim']->reference,
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $tenantId = (int) $request->user()->tenant_id;

        $now = now();
        $periods = SubscriptionPeriod::where('tenant_id', $tenantId)
            ->with(['code.plan:id,name', 'code.collector:id,name'])
            ->orderByDesc('starts_at')
            ->orderByDesc('id')
            ->get()
            ->map(function (SubscriptionPeriod $p) use ($now) {
                $code = $p->code;

                // Temporal state of THIS period: the one running now is "active",
                // future ones "scheduled", past ones "ended" — this is what the
                // company cares about, distinct from the code's redemption status.
                // An admin-ended period is kept on the books but no longer runs.
                $periodStatus = ($p->isCanceled() || $p->ends_at->isBefore($now)) ? 'ended'
                    : ($p->starts_at->isAfter($now) ? 'scheduled' : 'active');

                return [
                    'id' => $p->id,
                    'plan' => $code?->plan?->name,
                    'code' => $code?->code,
                    'payment_ref' => $code?->payment_ref,
                    'payment_method' => $code?->payment_method,
                    'code_status' => $code?->status(),
                    'period_status' => $periodStatus,
                    'canceled' => $p->isCanceled(),
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
