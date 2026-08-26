<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\SendTemplatedMail;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Concerns\GeneratesOtp;
use App\Http\Controllers\Controller;
use App\Models\PasswordReset;
use App\Models\User;
use App\Support\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Authentication for the mobile driver app. Drivers activate an emailed
 * invitation (set a password), then sign in for a Sanctum bearer token. Kept
 * separate from the manager AuthController: different guard, no SPA session.
 */
class DriverAuthController extends Controller
{
    use GeneratesOtp;

    private const OTP_TTL_MINUTES = 10;

    private const MAX_ATTEMPTS = 5;

    public function __construct(private readonly DriverInvitationService $invitations) {}

    /**
     * Passwordless sign-in step 1: email a 6-digit code. Works for a driver
     * (invited or activated) or a fleet owner/manager. Never discloses whether
     * an account exists.
     */
    public function loginRequest(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        $name = $this->accountName($data['email']);
        if ($name !== null) {
            $reset = PasswordReset::updateOrCreate(
                ['email' => $data['email']],
                [
                    'otp' => $this->newOtp(),
                    'otp_expires_at' => CarbonImmutable::now()->addMinutes(self::OTP_TTL_MINUTES),
                    'attempts' => 0,
                ],
            );

            SendTemplatedMail::to($data['email'], 'driver_login_otp', ['name' => $name, 'otp' => $reset->otp]);
        }

        return response()->json(['data' => ['sent' => true]]);
    }

    /**
     * Passwordless sign-in step 2: verify the code and issue a token. A driver is
     * activated on first successful code; a fleet owner signs in read-only. No
     * password is ever set or checked.
     */
    public function loginVerify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'otp' => ['required', 'digits:6'],
        ]);

        $reset = $this->validOtpOrFail($data['email'], $data['otp']);

        $driver = Driver::withoutGlobalScopes()->where('email', $reset->email)->first();
        if ($driver !== null) {
            $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);
            $driver->forceFill([
                'activated_at' => $driver->activated_at ?? now(),
                'invite_token' => null,
                'last_login_at' => now(),
            ])->save();
            $reset->delete();

            return $this->tokenResponse($driver);
        }

        $owner = $this->findOwnerByEmail($reset->email);
        if ($owner !== null) {
            $this->guardSuspendedTenant($owner->loadMissing('tenant')->tenant);
            $reset->delete();

            return $this->ownerTokenResponse($owner);
        }

        $reset->delete();
        throw ValidationException::withMessages(['otp' => 'otp_none']);
    }

    /** Preview an invitation so the activation screen can greet the driver. */
    public function invite(string $token): JsonResponse
    {
        $driver = $this->invitations->findByToken($token);
        if ($driver === null) {
            return response()->json(['message' => 'invite_invalid'], 404);
        }

        return response()->json([
            'data' => [
                'driver_name' => $driver->name,
                'company_name' => $driver->tenant?->name,
                'email' => $driver->email,
            ],
        ]);
    }

    /** Consume an invitation: set the password and issue a token. */
    public function activate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $driver = $this->invitations->findByToken($data['token']);
        if ($driver === null) {
            return response()->json(['message' => 'invite_invalid'], 404);
        }

        $this->guardSuspended($driver);
        $this->invitations->activate($driver, $data['password']);

        return $this->tokenResponse($driver);
    }

    /**
     * Email + password sign-in. The same screen serves two identities: a driver
     * (guard `driver`), or a company owner/manager signing in with their
     * dashboard credentials to monitor the whole fleet read-only.
     */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $driver = Driver::withoutGlobalScopes()->where('email', $data['email'])->first();
        if ($driver !== null && $driver->activated_at !== null && Hash::check($data['password'], (string) $driver->password)) {
            $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);
            $driver->forceFill(['last_login_at' => now()])->save();

            return $this->tokenResponse($driver);
        }

        $owner = $this->findOwner($data['email'], $data['password']);
        if ($owner !== null) {
            $this->guardSuspendedTenant($owner->loadMissing('tenant')->tenant);

            return $this->ownerTokenResponse($owner);
        }

        throw ValidationException::withMessages(['email' => [__('auth.failed')]]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->profile($request->user())]);
    }

    /** The driver edits their own name, app language, and (optionally) password. */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'locale' => ['sometimes', 'in:de,en,ar'],
            'password' => ['sometimes', 'string', 'min:8'],
        ]);

        $driver = $request->user();
        $driver->fill(array_intersect_key($data, array_flip(['name', 'locale', 'password'])));
        $driver->save();

        return response()->json(['data' => $this->profile($driver)]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    /** A suspended company (disabled / banned / expired) blocks the driver app. */
    private function guardSuspended(Driver $driver): void
    {
        $this->guardSuspendedTenant($driver->loadMissing('tenant')->tenant);
    }

    /** Abort with the app's "account suspended" contract when the tenant is blocked. */
    private function guardSuspendedTenant(?Tenant $tenant): void
    {
        $reason = $tenant?->stateReason();
        if ($reason !== null) {
            abort(response()->json([
                'message' => 'account_suspended',
                'reason' => $reason,
                'support_email' => Settings::get('support_email'),
                'support_whatsapp' => Settings::get('support_whatsapp'),
            ], 403));
        }
    }

    /**
     * A dashboard manager/owner signing into the driver app: must belong to a
     * tenant and hold an app-relevant role. Returns null on any mismatch.
     */
    private function findOwner(string $email, string $password): ?User
    {
        $user = User::where('email', $email)->first();
        if ($user === null
            || $user->tenant_id === null
            || ! $user->hasAnyRole(['fleet_manager', 'owner'])
            || ! Hash::check($password, (string) $user->password)) {
            return null;
        }

        return $user;
    }

    /**
     * A display name for the OTP email, or null when no app account owns this
     * email (driver — invited or activated — or an app-relevant owner/manager).
     */
    private function accountName(string $email): ?string
    {
        $driver = Driver::withoutGlobalScopes()->where('email', $email)->first();
        if ($driver !== null) {
            return (string) $driver->name;
        }

        $owner = $this->findOwnerByEmail($email);

        return $owner !== null ? (string) $owner->name : null;
    }

    /** A dashboard owner/manager matched by email alone (passwordless sign-in). */
    private function findOwnerByEmail(string $email): ?User
    {
        $user = User::where('email', $email)->first();
        if ($user === null
            || $user->tenant_id === null
            || ! $user->hasAnyRole(['fleet_manager', 'owner'])) {
            return null;
        }

        return $user;
    }

    /**
     * Resolve a pending OTP whose code matches, or throw a coded validation error
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

    private function tokenResponse(Driver $driver): JsonResponse
    {
        $token = $driver->createToken('driver-app')->plainTextToken;

        return response()->json([
            'data' => ['token' => $token, 'is_owner' => false, 'driver' => $this->profile($driver)],
        ]);
    }

    private function ownerTokenResponse(User $owner): JsonResponse
    {
        $token = $owner->createToken('driver-app')->plainTextToken;

        return response()->json([
            'data' => ['token' => $token, 'is_owner' => true, 'owner' => $this->ownerProfile($owner)],
        ]);
    }

    /** @return array<string, mixed> */
    private function profile(Driver $driver): array
    {
        $driver->loadMissing('tenant');

        return [
            'id' => $driver->id,
            'name' => $driver->name,
            'email' => $driver->email,
            'locale' => $driver->locale,
            'company_name' => $driver->tenant?->name,
            'uber_linked' => $driver->uber_driver_uuid !== null,
            'is_owner' => false,
        ];
    }

    /** @return array<string, mixed> */
    private function ownerProfile(User $owner): array
    {
        $owner->loadMissing('tenant');

        return [
            'id' => $owner->id,
            'name' => $owner->name,
            'email' => $owner->email,
            'locale' => $owner->locale,
            'company_name' => $owner->tenant?->name,
            // Owners don't link a personal Uber; reflect the company's fleet
            // session instead, so the profile matches the dashboard's status.
            'uber_linked' => $this->tenantUberLinked($owner->tenant_id),
            'is_owner' => true,
        ];
    }

    /** True when the owner's company has an active captured Uber fleet session. */
    private function tenantUberLinked(?int $tenantId): bool
    {
        return $tenantId !== null
            && UberFleetSession::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', UberFleetSession::STATUS_ACTIVE)
                ->exists();
    }
}
