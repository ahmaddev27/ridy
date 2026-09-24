<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\AccountDeletionService;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Delete my account" from the mobile app — for drivers (auth:driver) and for
 * fleet owners signed into the app (User token). Deliberately outside the
 * `driver.active` gate: a suspended company's driver must still be able to ask.
 */
class AccountDeletionController extends Controller
{
    /** Sanctum token name the app mints for owners (DriverAuthController). */
    private const OWNER_APP_TOKEN = 'driver-app-owner';

    public function __construct(private readonly AccountDeletionService $deletions) {}

    public function driver(Request $request): JsonResponse
    {
        $driver = $request->user();
        abort_unless($driver instanceof Driver, 403);

        $this->deletions->requestForDriver($driver);

        return response()->json(['data' => ['requested' => true]], 202);
    }

    public function owner(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        $this->deletions->requestForOwner($user, self::OWNER_APP_TOKEN);

        return response()->json(['data' => ['requested' => true]], 202);
    }
}
