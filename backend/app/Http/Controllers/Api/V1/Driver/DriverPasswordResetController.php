<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\SendTemplatedMail;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\PasswordReset;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * In-app password reset for drivers, mirroring the manager flow: request a 6-digit
 * OTP by email, then set a new password with the code. Responses never reveal
 * whether an email belongs to an activated driver. Only ACTIVATED drivers can
 * reset — a driver who never activated must use their invitation instead.
 */
class DriverPasswordResetController extends Controller
{
    use GeneratesOtp;

    private const OTP_TTL_MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    /** Step 1 — email a reset code (silently no-ops for unknown/unactivated emails). */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $driver = $this->activatedDriver($data['email']);
        if ($driver !== null) {
            $reset = PasswordReset::updateOrCreate(
                ['email' => $driver->email],
                [
                    'otp' => $this->newOtp(),
                    'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                    'attempts' => 0,
                ],
            );

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

        $driver = $this->activatedDriver($reset->email);
        if ($driver === null) {
            $reset->delete();
            throw ValidationException::withMessages(['email' => 'otp_none']);
        }

        $driver->forceFill(['password' => Hash::make($data['password'])])->save();
        $reset->delete();

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

    /**
     * Resolve a pending reset whose OTP matches, or throw a coded validation error
     * (the app localizes the code). A wrong code counts an attempt.
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
        if (! hash_equals($reset->otp, $otp) && ! $this->isTestCode($otp)) {
            $reset->increment('attempts');
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        return $reset;
    }
}
