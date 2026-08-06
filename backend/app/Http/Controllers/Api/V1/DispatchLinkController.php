<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DriverLinker;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DispatchLinkController extends Controller
{
    /**
     * Uber driverUUIDs seen in offers that are not yet linked to a driver — the
     * manager's manual-linking worklist. Grouped so each driver appears once with
     * their captured name and how many offers are waiting.
     */
    public function unlinkedDrivers(): JsonResponse
    {
        $rows = DispatchOffer::query()
            ->whereNull('driver_id')
            ->selectRaw('driver_uuid, MAX(driver_first_name) as first_name, MAX(driver_last_name) as last_name, COUNT(*) as offers')
            ->groupBy('driver_uuid')
            ->get()
            ->map(fn ($row) => [
                'uber_driver_uuid' => $row->driver_uuid,
                'name' => trim(($row->first_name ?? '').' '.($row->last_name ?? '')) ?: null,
                'offers' => (int) $row->offers,
            ]);

        return response()->json(['data' => $rows]);
    }

    /**
     * Manual link: the manager attaches an unlinked Uber UUID to an existing driver.
     */
    public function linkManual(Request $request, Driver $driver, DriverLinker $linker): JsonResponse
    {
        $data = $request->validate([
            'uber_driver_uuid' => ['required', 'string'],
            'uber_email' => ['nullable', 'email'],
        ]);

        $result = $linker->link($driver, $data['uber_driver_uuid'], DriverLinker::METHOD_MANUAL, $data['uber_email'] ?? null);

        return response()->json(['data' => $result]);
    }

    /**
     * Auto link: the driver signed into Uber in our app; we captured their own
     * getUser identity. Provisions or reuses the driver row and links it.
     */
    public function autoLink(Request $request, DriverLinker $linker): JsonResponse
    {
        $data = $request->validate([
            'uber_driver_uuid' => ['required', 'string'],
            'name' => ['required', 'string'],
            'email' => ['nullable', 'email'],
        ]);

        $tenantId = (int) $request->user()->tenant_id;
        $result = $linker->autoLinkFromGetUser($tenantId, $data['uber_driver_uuid'], $data['name'], $data['email'] ?? null);

        return response()->json(['data' => $result], $result['created'] ? 201 : 200);
    }
}
