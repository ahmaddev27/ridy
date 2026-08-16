<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Settings;
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
    public function __construct(private readonly DriverInvitationService $invitations) {}

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
            'uber_linked' => false,
            'is_owner' => true,
        ];
    }
}
