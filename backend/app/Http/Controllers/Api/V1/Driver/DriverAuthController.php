<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
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

    /** Email + password sign-in. */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $driver = Driver::withoutGlobalScopes()->where('email', $data['email'])->first();
        if ($driver === null || $driver->activated_at === null || ! Hash::check($data['password'], (string) $driver->password)) {
            throw ValidationException::withMessages(['email' => [__('auth.failed')]]);
        }

        $this->guardSuspended($driver);
        $driver->forceFill(['last_login_at' => now()])->save();

        return $this->tokenResponse($driver);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->profile($request->user())]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    /** A suspended company (disabled / banned / expired) blocks its drivers too. */
    private function guardSuspended(Driver $driver): void
    {
        $reason = $driver->loadMissing('tenant')->tenant?->stateReason();
        if ($reason !== null) {
            abort(response()->json([
                'message' => 'account_suspended',
                'reason' => $reason,
                'support_email' => Settings::get('support_email'),
                'support_whatsapp' => Settings::get('support_whatsapp'),
            ], 403));
        }
    }

    private function tokenResponse(Driver $driver): JsonResponse
    {
        $token = $driver->createToken('driver-app')->plainTextToken;

        return response()->json([
            'data' => ['token' => $token, 'driver' => $this->profile($driver)],
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
        ];
    }
}
