<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Notifications\Notifier;
use App\Domain\Notifications\SendTemplatedMail;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
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
    use GeneratesOtp;

    private const OTP_TTL_MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    /** Step 1 — collect details, create a pending registration, email the OTP. */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'company_name' => ['required', 'string', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:32'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        // Non-disclosing: never reveal whether the email is already taken. If a
        // user already exists, skip creating a registration / sending an OTP, but
        // return the same neutral shape as the happy path so the response can't
        // be used as an account-existence oracle.
        if (User::where('email', $data['email'])->exists()) {
            return response()->json(['data' => ['email' => $data['email']]]);
        }

        $registration = Registration::updateOrCreate(
            ['email' => $data['email']],
            [
                'company_name' => $data['company_name'],
                'name' => $data['name'],
                'phone' => $data['phone'],
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
    public function verify(Request $request, Notifier $notifier): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
        ]);

        $registration = Registration::where('email', $data['email'])->first();
        if ($registration === null) {
            throw ValidationException::withMessages(['otp' => 'otp_none']);
        }
        if ($registration->otp_expires_at->isPast()) {
            throw ValidationException::withMessages(['otp' => 'otp_expired']);
        }
        if ($registration->attempts >= self::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['otp' => 'otp_too_many']);
        }
        if (! hash_equals($registration->otp, $data['otp']) && ! $this->isTestCode($data['otp'])) {
            $registration->increment('attempts');
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }

        $tenant = DB::transaction(function () use ($registration) {
            $tenant = Tenant::create([
                'name' => $registration->company_name,
                'country' => 'DE',
                'status' => 'active',
            ]);
            $user = User::create([
                'name' => $registration->name,
                'email' => $registration->email,
                'phone' => $registration->phone,
                'password' => $registration->password, // already hashed
                'tenant_id' => $tenant->id,
            ]);
            // The OTP proved ownership of the email → mark it verified.
            $user->forceFill(['email_verified_at' => CarbonImmutable::now()])->save();
            $user->assignRole('fleet_manager');

            $registration->delete();

            return $tenant;
        });

        // Let the platform admins know a new company just signed up.
        $notifier->toAdmins('company_registered', ['company' => $tenant->name], '/admin/companies');

        return response()->json(['data' => ['verified' => true]]);
    }

    /** Resend a fresh OTP (rate-limited by the route). */
    public function resend(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        // Non-disclosing: always return the same neutral shape, whether or not a
        // pending registration exists, so this can't reveal registration state.
        $registration = Registration::where('email', $data['email'])->first();
        if ($registration !== null) {
            $registration->update([
                'otp' => $this->newOtp(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                'attempts' => 0,
            ]);
            $this->sendOtp($registration);
        }

        return response()->json(['data' => ['email' => $data['email']]]);
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
