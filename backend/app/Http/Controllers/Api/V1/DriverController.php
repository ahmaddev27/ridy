<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\UberSupplierClient;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Http\Resources\DriverResource;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DriverController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $drivers = Driver::query()->orderBy('name')->paginate(50);

        return DriverResource::collection($drivers);
    }

    /**
     * The Ridy extension fetched supplier /api/getDrivers from the manager's own
     * browser (real IP, so Uber responds) and posts the driver list here. This is
     * the reliable path — server-side pulls get blocked by Uber's datacenter check.
     */
    public function ingestRoster(Request $request, RosterSyncService $roster): JsonResponse
    {
        $data = $request->validate(['drivers' => ['required', 'array']]);

        $tenantId = (int) $request->user()->tenant_id;
        $result = $roster->sync($tenantId, $data['drivers']);

        return response()->json(['data' => $result]);
    }

    /**
     * Live online/offline presence, posted by the extension after querying
     * Uber's GetDriverLiveLocation. Matched to drivers by Uber UUID.
     */
    public function ingestStatuses(Request $request): JsonResponse
    {
        $data = $request->validate([
            'statuses' => ['required', 'array'],
            'statuses.*.driver_uuid' => ['required', 'string'],
            'statuses.*.status' => ['nullable', 'string'],
            'statuses.*.location_updated_at' => ['nullable', 'numeric'], // ms epoch
        ]);

        $updated = 0;
        foreach ($data['statuses'] as $row) {
            $updated += Driver::where('uber_driver_uuid', $row['driver_uuid'])->update([
                'online_status' => $row['status'] ?? null,
                'location_updated_at' => ! empty($row['location_updated_at'])
                    ? CarbonImmutable::createFromTimestampMs($row['location_updated_at']) : null,
                'status_synced_at' => now(),
            ]);
        }

        return response()->json(['data' => ['updated' => $updated]]);
    }

    /**
     * Server-side on-demand pull (fallback). Often blocked by Uber's datacenter
     * check — the extension path (ingestRoster) is the reliable one.
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
