<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\SendTemplatedMail;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\PasswordReset;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Password reset via an email OTP. The user requests a code, receives a 6-digit
 * OTP, and sets a new password by supplying the code. Responses never reveal
 * whether an email is registered.
 */
class PasswordResetController extends Controller
{
    use GeneratesOtp;

    private const OTP_TTL_MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    /** Step 1 — email a reset code (silently no-ops for unknown emails). */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $user = User::where('email', $data['email'])->first();
        if ($user !== null) {
            $reset = PasswordReset::updateOrCreate(
                ['email' => $user->email],
                [
                    'otp' => $this->newOtp(),
                    'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                    'attempts' => 0,
                ],
            );

            SendTemplatedMail::to($user->email, 'password_otp', ['name' => $user->name, 'otp' => $reset->otp]);
        }

        // Always 200 — do not disclose whether the address exists.
        return response()->json(['data' => ['sent' => true]]);
    }

    /** Step 2 — verify the OTP alone (no password change yet). */
    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
        ]);

        $this->validOtpOrFail($data['email'], $data['otp']);

        return response()->json(['data' => ['verified' => true]]);
    }

    /** Step 3 — re-check the OTP and set the new password. */
    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $reset = $this->validOtpOrFail($data['email'], $data['otp']);

        $user = User::where('email', $reset->email)->first();
        if ($user === null) {
            $reset->delete();
            throw ValidationException::withMessages(['email' => 'otp_none']);
        }

        $user->forceFill(['password' => Hash::make($data['password'])])->save();
        $reset->delete();

        return response()->json(['data' => ['reset' => true]]);
    }

    /**
     * Resolve a pending reset whose OTP matches, or throw a coded validation
     * error (the frontend localizes the code). A wrong code counts an attempt.
     */
    private function validOtpOrFail(string $email, string $otp): PasswordReset
    {
        $reset = PasswordReset::where('email', $email)->first();
        if ($reset === null) {
            throw ValidationException::withMessages(['otp' => 'otp_none']);
        }
        if ($reset->otp_expires_at->isPast()) {
            throw ValidationException::withMessages(['otp' => 'otp_expired']);
        }
        if ($reset->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }
        if (! hash_equals($reset->otp, $otp)) {
            $reset->increment('attempts');
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        return $reset;
    }
}
