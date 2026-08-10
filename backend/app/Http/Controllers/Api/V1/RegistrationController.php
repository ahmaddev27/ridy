<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\SendTemplatedMail;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Models\Registration;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Company self-registration with an email OTP. A company signs up, receives a
 * 6-digit code, and on verification a Tenant + owner User are created.
 */
class RegistrationController extends Controller
{
    private const OTP_TTL_MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    /** Step 1 — collect details, create a pending registration, email the OTP. */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'company_name' => ['required', 'string', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $registration = Registration::updateOrCreate(
            ['email' => $data['email']],
            [
                'company_name' => $data['company_name'],
                'name' => $data['name'],
                'password' => Hash::make($data['password']),
                'otp' => $this->newOtp(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                'attempts' => 0,
            ],
        );

        $this->sendOtp($registration);

        return response()->json(['data' => ['email' => $registration->email]]);
    }

    /** Step 2 — verify the OTP, create the company + owner, and clean up. */
    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'string'],
        ]);

        $registration = Registration::where('email', $data['email'])->first();
        if ($registration === null) {
            throw ValidationException::withMessages(['otp' => __('No pending registration for this email.')]);
        }
        if ($registration->otp_expires_at->isPast()) {
            throw ValidationException::withMessages(['otp' => __('The code has expired. Please resend.')]);
        }
        if ($registration->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['otp' => __('Too many attempts. Please resend a new code.')]);
        }
        if (! hash_equals($registration->otp, $data['otp'])) {
            $registration->increment('attempts');
            throw ValidationException::withMessages(['otp' => __('Incorrect code.')]);
        }

        DB::transaction(function () use ($registration) {
            $tenant = Tenant::create([
                'name' => $registration->company_name,
                'country' => 'DE',
                'status' => 'active',
            ]);
            $user = User::create([
                'name' => $registration->name,
                'email' => $registration->email,
                'password' => $registration->password, // already hashed
                'tenant_id' => $tenant->id,
            ]);
            // The OTP proved ownership of the email → mark it verified.
            $user->forceFill(['email_verified_at' => CarbonImmutable::now()])->save();
            $user->assignRole('fleet_manager');

            $registration->delete();
        });

        return response()->json(['data' => ['verified' => true]]);
    }

    /** Resend a fresh OTP (rate-limited by the route). */
    public function resend(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $registration = Registration::where('email', $data['email'])->first();
        if ($registration === null) {
            throw ValidationException::withMessages(['email' => __('No pending registration for this email.')]);
        }

        $registration->update([
            'otp' => $this->newOtp(),
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
            'attempts' => 0,
        ]);
        $this->sendOtp($registration);

        return response()->json(['data' => ['email' => $registration->email]]);
    }

    private function newOtp(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private function sendOtp(Registration $registration): void
    {
        SendTemplatedMail::to(
            $registration->email,
            'company_otp',
            ['name' => $registration->name, 'otp' => $registration->otp],
        );
    }
}
