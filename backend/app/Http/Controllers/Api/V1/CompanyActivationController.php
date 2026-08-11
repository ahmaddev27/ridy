<?php

namespace App\Http\Controllers\Api\V1;

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
        if ($tenant->activation_code === null || $tenant->activation_code_expires_at?->isPast()) {
            throw ValidationException::withMessages(['code' => 'activation_expired']);
        }

        if (! hash_equals($tenant->activation_code, $data['code'])) {
            $tenant->increment('activation_attempts');
            if ($tenant->activation_attempts >= self::MAX_ATTEMPTS) {
                $tenant->forceFill(['banned_at' => CarbonImmutable::now()])->save();

                return response()->json(['message' => 'account_suspended', 'reason' => 'banned'], 403);
            }
            throw ValidationException::withMessages(['code' => 'otp_incorrect']);
        }

        $tenant->forceFill([
            'status' => 'active',
            'banned_at' => null,
            'activated_at' => CarbonImmutable::now(),
            'subscription_ends_at' => CarbonImmutable::now()->addDays((int) $tenant->activation_days),
            'activation_code' => null,
            'activation_code_expires_at' => null,
            'activation_days' => null,
            'activation_attempts' => 0,
        ])->save();

        return response()->json(['data' => ['activated' => true]]);
    }
}
