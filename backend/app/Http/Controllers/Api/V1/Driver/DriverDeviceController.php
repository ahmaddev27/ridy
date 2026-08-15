<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The authenticated driver app registers (and refreshes) its FCM push token.
 * Idempotent on the token so re-registration on every launch is safe.
 */
class DriverDeviceController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $driver = $request->user();

        $device = DeviceToken::updateOrCreate(
            ['token' => $data['token']],
            [
                'tenant_id' => $driver->tenant_id,
                'driver_id' => $driver->id,
                'platform' => $data['platform'] ?? 'android',
                'last_used_at' => now(),
            ],
        );

        return response()->json(['data' => ['id' => $device->id]], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        DeviceToken::where('driver_id', $request->user()->id)
            ->where('token', (string) $request->input('token'))
            ->delete();

        return response()->json(['message' => 'ok']);
    }
}
