<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Concerns\CapturesDeviceInfo;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The authenticated driver app registers (and refreshes) its FCM push token.
 * Idempotent on the token so re-registration on every launch is safe.
 */
class DriverDeviceController extends Controller
{
    use CapturesDeviceInfo;

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['nullable', 'in:android,ios'],
            'device_name' => ['nullable', 'string', 'max:120'],
            'os_version' => ['nullable', 'string', 'max:40'],
        ]);

        $driver = $request->user();

        $device = DeviceToken::updateOrCreate(
            ['token' => $data['token']],
            [
                'tenant_id' => $driver->tenant_id,
                'driver_id' => $driver->id,
                // Clear any prior fleet-owner claim on this exact device: the same
                // phone that was signed in as a manager and is now a driver must
                // NOT keep receiving the tenant-wide owner fan-out.
                'user_id' => null,
                'platform' => $data['platform'] ?? 'android',
                'last_used_at' => now(),
                ...$this->deviceInfo($data),
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
