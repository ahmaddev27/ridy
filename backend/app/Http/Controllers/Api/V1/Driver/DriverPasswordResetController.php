<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Auth\OtpGuard;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\SendTemplatedMail;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * In-app password reset for drivers, mirroring the manager flow: request a 6-digit
 * OTP by email, then set a new password with the code. Responses never reveal
 * whether an email belongs to an activated driver. Only ACTIVATED drivers can
 * reset — a driver who never activated must use their invitation instead. Code
 * checks + brute-force limits live in OtpGuard.
 */
class DriverPasswordResetController extends Controller
{
    private const OTP_TTL_MINUTES = 10;

    public function __construct(private readonly OtpGuard $otp) {}

    /** Step 1 — email a reset code (silently no-ops for unknown/unactivated emails). */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $driver = $this->activatedDriver($data['email']);
        if ($driver !== null) {
            $reset = $this->otp->issueReset($driver->email, self::OTP_TTL_MINUTES);

            SendTemplatedMail::to($driver->email, 'password_otp', ['name' => (string) $driver->name, 'otp' => $reset->otp]);
        }

        // Always 200 — do not disclose whether the address exists.
        return response()->json(['data' => ['sent' => true]]);
    }

    /** Step 2 — verify the OTP alone (lets the app gate the new-password field). */
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

        $driver = $this->activatedDriver($reset->email);
        if ($driver === null) {
            // Same answer as a wrong code — never reveal whether the account exists.
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        $driver->forceFill(['password' => Hash::make($data['password'])])->save();
        // A password reset is the user's tool to evict an attacker who has their
        // token — so revoke every existing Sanctum token. The driver simply signs
        // in again to get a fresh one.
        $driver->tokens()->delete();

        return response()->json(['data' => ['reset' => true]]);
    }

    /** An activated driver (has a password set) matching the email, tenant-agnostic. */
    private function activatedDriver(string $email): ?Driver
    {
        return Driver::withoutGlobalScopes()
            ->where('email', $email)
            ->whereNotNull('activated_at')
            ->first();
    }
}
