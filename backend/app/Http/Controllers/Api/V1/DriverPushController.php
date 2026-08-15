<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Models\DeviceToken;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Manager-side diagnostic: send a test push to one of the company's drivers so
 * they can confirm the device is registered and notifications arrive before
 * relying on a live offer. Tenant-scoped via route-model binding.
 */
class DriverPushController extends Controller
{
    public function __construct(private readonly PushSender $sender) {}

    public function test(Driver $driver): JsonResponse
    {
        $tokens = DeviceToken::where('driver_id', $driver->id)->get();

        if ($tokens->isEmpty()) {
            return response()->json(['message' => 'no_devices'], 422);
        }

        $sent = 0;
        foreach ($tokens as $token) {
            if ($this->sender->send($token->token, 'Reidey', 'Test — Benachrichtigungen funktionieren ✅', ['type' => 'test'])) {
                $sent++;
            }
        }

        return response()->json(['data' => ['sent' => $sent, 'devices' => $tokens->count()]]);
    }
}
