<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * A company owner activates (or renews) their subscription by entering the code
 * the admin generated. Three wrong codes ban the account until an admin lifts it.
 */
class CompanyActivationController extends Controller
{
    use GeneratesOtp;

    private const MAX_ATTEMPTS = 3;

    public function activate(Request $request): JsonResponse
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
        $testCode = $this->isTestCode($data['code']);
        if ($tenant->activation_code === null || ($tenant->activation_code_expires_at?->isPast() && ! $testCode)) {
            throw ValidationException::withMessages(['code' => 'activation_expired']);
        }

        if (! hash_equals($tenant->activation_code, $data['code']) && ! $testCode) {
            $tenant->increment('activation_attempts');
            if ($tenant->activation_attempts >= self::MAX_ATTEMPTS) {
                $tenant->forceFill(['banned_at' => CarbonImmutable::now()])->save();

                return response()->json(['message' => 'account_suspended', 'reason' => 'banned'], 403);
            }
            throw ValidationException::withMessages(['code' => 'otp_incorrect']);
        }

        $days = (int) $tenant->activation_days;
        $startsAt = CarbonImmutable::now();
        $endsAt = $startsAt->addDays($days);

        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activated_at' => $startsAt,
            'subscription_ends_at' => $endsAt,
            'activation_code' => null,
            'activation_code_expires_at' => null,
            'activation_days' => null,
            'activation_attempts' => 0,
        ])->save();

        // Record the paid period as an invoice for billing reports.
        SubscriptionPeriod::create([
            'tenant_id' => $tenant->id,
            'days' => $days,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
        ]);

        // Now that it's active, place it on a proxy from the pool.
        app(ProxyPool::class)->assign($tenant);

        return response()->json(['data' => ['activated' => true]]);
    }
}
