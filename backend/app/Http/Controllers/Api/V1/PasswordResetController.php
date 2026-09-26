<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\OtpGuard;
use App\Domain\Notifications\SendTemplatedMail;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Password reset via an email OTP. The user requests a code, receives a 6-digit
 * OTP, and sets a new password by supplying the code. Responses never reveal
 * whether an email is registered. Code checks + brute-force limits live in
 * OtpGuard (shared with the driver app and sign-up).
 */
class PasswordResetController extends Controller
{
    private const OTP_TTL_MINUTES = 10;

    public function __construct(private readonly OtpGuard $otp) {}

    /** Step 1 — email a reset code (silently no-ops for unknown emails). */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $user = User::where('email', $data['email'])->first();
        if ($user !== null) {
            $reset = $this->otp->issueReset($user->email, self::OTP_TTL_MINUTES);

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

        $this->otp->verifyReset($data['email'], $data['otp']);

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

        $reset = $this->otp->verifyReset($data['email'], $data['otp']);
        // Spend the code once, before the password changes.
        $this->otp->consume($reset);

        $user = User::where('email', $reset->email)->first();
        if ($user === null) {
            // Same answer as a wrong code — never reveal whether the account exists.
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        $user->forceFill(['password' => Hash::make($data['password'])])->save();
        // Revoke existing tokens so a reset actually evicts a stolen bearer token
        // (mirrors the driver reset). Cookie-session managers re-auth transparently.
        $user->tokens()->delete();

        return response()->json(['data' => ['reset' => true]]);
    }
}
