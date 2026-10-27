<?php

namespace App\Http\Controllers\Concerns;

use App\Domain\Billing\PaymentClaimService;
use App\Domain\Tenancy\Models\Tenant;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * The pre-login "account suspended" answer every dashboard sign-in gives —
 * password and passkey alike, byte for byte, so the suspended screen behaves
 * the same whichever credential brought the user there.
 *
 * Safe to surface the company's payment reference here: callers reach this
 * only AFTER the credential verified, so the caller owns the account. That is
 * what lets the "how to pay" screen show the reference before a session exists.
 */
trait RespondsSuspendedLogin
{
    protected function suspendedLoginResponse(Tenant $tenant, string $reason): JsonResponse
    {
        return response()->json([
            'message' => 'account_suspended',
            'reason' => $reason,
            'support_email' => Settings::get('support_email'),
            'support_whatsapp' => Settings::get('support_whatsapp'),
            'payment_reference' => $tenant->ensurePaymentReference(),
            'payment_claim_pending' => app(PaymentClaimService::class)->hasPending($tenant),
        ], 403);
    }
}
