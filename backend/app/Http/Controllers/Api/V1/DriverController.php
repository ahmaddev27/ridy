<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\UberSupplierClient;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Http\Resources\DriverResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DriverController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $drivers = Driver::query()->orderBy('name')->paginate(50);

        return DriverResource::collection($drivers);
    }

    /**
     * Pull the freshest roster from Uber on demand (the Drivers page triggers
     * this on load), using the tenant's active fleet session. Best-effort: if
     * Uber can't be reached, the cached roster is still shown.
     */
    public function sync(UberSupplierClient $client, RosterSyncService $roster): JsonResponse
    {
        $session = UberFleetSession::query()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->orderByDesc('updated_at')
            ->first();

        if ($session === null) {
            return response()->json(['data' => ['synced' => 0, 'reason' => 'no_active_session']]);
        }

        $drivers = $client->getDrivers($session);

        if ($drivers === []) {
            return response()->json(['data' => ['synced' => 0, 'reason' => 'uber_unreachable']]);
        }

        $result = $roster->sync((int) $session->tenant_id, $drivers);

        return response()->json(['data' => $result]);
    }
}
