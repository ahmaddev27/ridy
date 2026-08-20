<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\SubscriptionActivator;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * A company owner activates (or renews) their subscription by entering the code
 * the admin generated. Wrong codes trigger a temporary, self-healing lockout
 * (rate-limited per email + IP) — never a permanent tenant ban, which a stranger
 * who only knows the email could otherwise abuse to lock a company out.
 */
class CompanyActivationController extends Controller
{
    use GeneratesOtp;

    /** Wrong-code attempts allowed within the cooldown window before lockout. */
    private const MAX_ATTEMPTS = 3;

    /** How long the lockout lasts once tripped (seconds). */
    private const LOCKOUT_SECONDS = 900; // 15 minutes

    /** Days granted by a test code when no admin plan is attached (monthly). */
    public const TEST_CODE_DAYS = 30;

    public function activate(Request $request, SubscriptionActivator $activator): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'code' => ['required', 'digits:6'],
        ]);

        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => [__('auth.failed')]]);
        }

        $tenant = $user->tenant;
        if ($tenant === null) {
            throw ValidationException::withMessages(['code' => 'activation_no_company']);
        }
        if ($tenant->banned_at !== null) {
            return response()->json(['message' => 'account_suspended', 'reason' => 'banned'], 403);
        }

        // Temporary lockout after too many wrong codes — keyed by email + IP so a
        // wrong-code flood can't permanently disable the company. It expires on
        // its own after the cooldown window.
        $throttleKey = 'company-activate:'.mb_strtolower($data['email']).'|'.$request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_ATTEMPTS)) {
            return response()->json([
                'message' => 'too_many_attempts',
                'reason' => 'locked',
                'retry_after' => RateLimiter::availableIn($throttleKey),
            ], 429);
        }

        // A real admin/reseller-issued code always takes priority over the test
        // code, so a generated code that happens to equal OTP_TEST_CODE still
        // links its ledger entry and grants the plan's days (not the test default).
        $hasCode = $tenant->activation_code !== null;
        $expired = $tenant->activation_code_expires_at?->isPast() ?? false;
        $realMatch = $hasCode && ! $expired && hash_equals($tenant->activation_code, $data['code']);
        $testCode = ! $realMatch && $this->isTestCode($data['code']);

        if (! $hasCode || ($expired && ! $testCode)) {
            throw ValidationException::withMessages(['code' => 'activation_expired']);
        }
        if (! $realMatch && ! $testCode) {
            RateLimiter::hit($throttleKey, self::LOCKOUT_SECONDS);
            throw ValidationException::withMessages(['code' => 'otp_incorrect']);
        }

        // Correct code — clear any accumulated wrong-attempt counter.
        RateLimiter::clear($throttleKey);

        // A test code with no admin-generated plan grants a default monthly period.
        $days = (int) $tenant->activation_days;
        if ($testCode && $days <= 0) {
            $days = self::TEST_CODE_DAYS;
        }

        $activator->apply(
            $tenant,
            $days,
            $tenant->activation_amount,
            (bool) $tenant->activation_paid,
            $tenant->activation_collector_id,
            $realMatch ? $tenant->activation_code : null,
        );

        return response()->json(['data' => ['activated' => true]]);
    }
}
