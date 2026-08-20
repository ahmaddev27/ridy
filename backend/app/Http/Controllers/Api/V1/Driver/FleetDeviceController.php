<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A fleet owner/manager signed into the mobile app (User token) registers their
 * FCM push token so they receive a copy of every one of their drivers' offers.
 * Mirrors DriverDeviceController but stores the token against the user + tenant.
 * Idempotent on the token so re-registration on every launch is safe.
 */
class FleetDeviceController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $owner = $this->owner($request);

        $device = DeviceToken::updateOrCreate(
            ['token' => $data['token']],
            [
                'tenant_id' => $owner->tenant_id,
                'user_id' => $owner->id,
                'driver_id' => null,
                'platform' => $data['platform'] ?? 'android',
                'last_used_at' => now(),
            ],
        );

        return response()->json(['data' => ['id' => $device->id]], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        DeviceToken::where('user_id', $this->owner($request)->id)
            ->where('token', (string) $request->input('token'))
            ->delete();

        return response()->json(['message' => 'ok']);
    }

    /** Ensure the caller is a tenant-bound owner/manager. */
    private function owner(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        return $user;
    }
}
