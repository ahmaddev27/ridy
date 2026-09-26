<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Auth\OtpGuard;
use App\Domain\Notifications\Notifier;
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
 * 6-digit code, and on verification a Tenant + owner User are created. Code
 * checks + brute-force limits live in OtpGuard.
 */
class RegistrationController extends Controller
{
    private const OTP_TTL_MINUTES = 10;

    public function __construct(private readonly OtpGuard $otp) {}

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
                'otp' => $this->otp->newCode(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                'attempts' => 0,
            ],
        );

        $this->sendOtp($registration);
        $this->otp->unlockClient($registration->email);
        $this->bindToBrowser($request, $registration);

        return response()->json(['data' => ['email' => $registration->email]]);
    }

    /** Step 2 — verify the OTP, create the company + owner, and clean up. */
    public function verify(Request $request, Notifier $notifier): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
        ]);

        $registration = $this->otp->verify(
            Registration::where('email', $data['email'])->first(),
            $data['email'],
            $data['otp'],
        );
        $this->assertSameSignup($request, $registration);

        $tenant = DB::transaction(function () use ($registration) {
            // Spend the code first: a concurrent second verify gets otp_incorrect
            // (and rolls back) instead of a duplicate company / a 500.
            $this->otp->consume($registration);

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
                'otp' => $this->otp->newCode(),
                'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                'attempts' => 0,
            ]);
            $this->sendOtp($registration);
            $this->otp->unlockClient($registration->email);
        }

        return response()->json(['data' => ['email' => $data['email']]]);
    }

    /**
     * Remember, in the browser session that started the sign-up, WHICH details
     * (password hash) it submitted. Anyone knowing the address can re-submit the
     * form mid-signup with their own password; without this the victim's code
     * would then activate the attacker's password.
     */
    private function bindToBrowser(Request $request, Registration $registration): void
    {
        if ($request->hasSession()) {
            $request->session()->put(self::sessionKey($registration->email), self::fingerprint($registration));
        }
    }

    /**
     * Refuse (as a wrong code) when this browser started a sign-up for the email
     * but the pending details were since replaced by someone else. A browser
     * without that session key (another device, no cookies) is not blocked.
     */
    private function assertSameSignup(Request $request, Registration $registration): void
    {
        if (! $request->hasSession()) {
            return;
        }

        $expected = $request->session()->get(self::sessionKey($registration->email));
        if (is_string($expected) && ! hash_equals($expected, self::fingerprint($registration))) {
            throw ValidationException::withMessages(['otp' => 'otp_incorrect']);
        }
    }

    private static function sessionKey(string $email): string
    {
        return 'registration.'.sha1(mb_strtolower(trim($email)));
    }

    private static function fingerprint(Registration $registration): string
    {
        return hash('sha256', (string) $registration->password);
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
