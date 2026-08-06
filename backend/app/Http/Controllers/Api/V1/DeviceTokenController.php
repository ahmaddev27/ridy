<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceTokenController extends Controller
{
    /**
     * The driver app registers its push token against the driver's Uber UUID
     * (captured at sign-in). Idempotent on the token so re-registration is safe.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'uber_driver_uuid' => ['required', 'string'],
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $driver = Driver::where('uber_driver_uuid', $data['uber_driver_uuid'])->firstOrFail();

        $device = DeviceToken::updateOrCreate(
            ['token' => $data['token']],
            [
                'tenant_id' => $driver->tenant_id,
                'driver_id' => $driver->id,
                'platform' => $data['platform'] ?? 'android',
                'last_used_at' => now(),
            ],
        );

        return response()->json(['data' => ['id' => $device->id, 'driver_id' => $driver->id]], 201);
    }
}
