<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Billing\ActivationCodeIssuer;
use App\Domain\Billing\Models\PaymentClaim;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\PaymentClaimService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Super-admin review of company "I've paid" claims: a pending list to reconcile
 * each incoming bank transfer by its payment reference, then confirm (verified)
 * or reject (with a reason) — the company is emailed either way.
 */
class PaymentClaimController extends Controller
{
    /**
     * Claims for the admin list. Defaults to PENDING (the review queue, oldest
     * first); `?status=all` returns the full archive and `?status=confirmed|
     * rejected|pending` filters, newest first for history.
     */
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', PaymentClaimService::PENDING);
        $onlyPending = $status === PaymentClaimService::PENDING;

        $claims = PaymentClaim::with(['tenant:id,name,payment_reference', 'resolver:id,name'])
            ->when(in_array($status, [PaymentClaimService::PENDING, PaymentClaimService::CONFIRMED, PaymentClaimService::REJECTED], true),
                fn ($q) => $q->where('status', $status))
            ->orderBy('created_at', $onlyPending ? 'asc' : 'desc')
            ->get()
            ->map(fn (PaymentClaim $c) => [
                'id' => $c->id,
                'tenant_id' => $c->tenant_id,
                'company' => $c->tenant?->name,
                'reference' => $c->reference,
                'status' => $c->status,
                'reason' => $c->reason,
                'resolved_by' => $c->resolver?->name,
                'resolved_at' => $c->resolved_at?->toIso8601String(),
                'created_at' => $c->created_at?->toIso8601String(),
            ]);

        return response()->json(['data' => $claims]);
    }

    /**
     * Confirm or reject a pending claim. On CONFIRM the admin picks a plan and an
     * activation code is issued (same flow as a manual code) and emailed with the
     * acceptance message. A REJECT requires a reason and emails it. Either way the
     * company is notified.
     */
    public function resolve(Request $request, PaymentClaim $claim, PaymentClaimService $service, ActivationCodeIssuer $issuer): JsonResponse
    {
        $confirmed = $request->input('status') === PaymentClaimService::CONFIRMED;

        $data = $request->validate([
            'status' => ['required', Rule::in([PaymentClaimService::CONFIRMED, PaymentClaimService::REJECTED])],
            'reason' => ['nullable', 'string', 'max:500', Rule::requiredIf(! $confirmed)],
            'plan_id' => [Rule::requiredIf($confirmed), 'integer'],
            'paid' => ['boolean'],
            'payment_method' => ['nullable', Rule::in(SubscriptionCode::PAYMENT_METHODS)],
        ]);

        if ($claim->status !== PaymentClaimService::PENDING) {
            return response()->json(['message' => 'claim_already_resolved'], 422);
        }

        $tenant = $claim->tenant;
        if ($tenant === null) {
            return response()->json(['message' => 'claim_company_missing'], 422);
        }

        $issueCode = null;
        if ($confirmed) {
            $plan = Plan::where('active', true)->find($data['plan_id']);
            if ($plan === null) {
                throw ValidationException::withMessages(['plan_id' => 'plan_unavailable']);
            }

            // Same code-issuing flow as a manual admin code; the acceptance email
            // carries the code so the company can activate right away. Runs inside
            // the service's claim transaction, so only the winning confirm issues.
            $admin = $request->user();
            $issueCode = fn () => $issuer->issue(
                $tenant, $plan, (bool) ($data['paid'] ?? true), $data['payment_method'] ?? 'bank', null, $admin->id,
            )['code'];
        }

        $claim = $service->resolve($claim, $confirmed, $data['reason'] ?? null, $request->user(), $issueCode);

        return response()->json(['data' => ['resolved' => true, 'status' => $claim->status]]);
    }
}
