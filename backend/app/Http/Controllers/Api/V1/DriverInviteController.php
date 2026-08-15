<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Manager-side action: invite one of the company's drivers to the mobile app.
 * The {driver} binding is tenant-scoped by the global scope, so a manager can
 * only ever invite their own drivers.
 */
class DriverInviteController extends Controller
{
    public function __construct(private readonly DriverInvitationService $invitations) {}

    public function send(Driver $driver): JsonResponse
    {
        $this->invitations->invite($driver);

        return response()->json([
            'data' => ['app_status' => $driver->appStatus(), 'invited_at' => $driver->invited_at],
        ]);
    }
}
