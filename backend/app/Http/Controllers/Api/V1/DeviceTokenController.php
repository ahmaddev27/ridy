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
        // Legacy route (the app registers via /driver/devices). Attaching a push
        // token to a driver routes that driver's live offers to the token, so it is
        // a management action — a read-only viewer must not be able to do it.
        abort_unless($request->user()?->can('drivers.manage'), 403);

        $data = $request->validate([
            'uber_driver_uuid' => ['required', 'string'],
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $driver = Driver::where('uber_driver_uuid', $data['uber_driver_uuid'])->firstOrFail();

        // The token is globally unique; the tenant-scoped updateOrCreate below would
        // miss another company's row and hit the unique index (500). Refuse instead
        // of silently re-pointing a foreign device.
        $existing = DeviceToken::withoutGlobalScopes()->where('token', $data['token'])->first();
        abort_if($existing !== null && (int) $existing->tenant_id !== (int) $driver->tenant_id, 409, 'token_in_use');

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
