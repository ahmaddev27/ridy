<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Vehicle;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Fleet vehicles. Ingested from the browser extension (which calls Uber's
 * supplier SearchVehicles) and listed for the Vehicles page.
 */
class VehicleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $vehicles = Vehicle::with('assignedDriver:id,name,uber_driver_uuid')
            ->orderBy('license_plate')
            ->get()
            ->map(fn (Vehicle $v) => [
                'id' => $v->id,
                'make' => $v->make,
                'model' => $v->model,
                'year' => $v->year,
                'license_plate' => $v->license_plate,
                'vin' => $v->vin,
                'color' => $v->color,
                'color_hex' => $v->color_hex,
                'image_url' => $v->image_url,
                'compliance_status' => $v->compliance_status,
                'assigned_driver' => $v->assignedDriver?->name,
                'synced_at' => $v->synced_at?->toIso8601String(),
            ]);

        return response()->json(['data' => $vehicles]);
    }

    /** Upsert the fleet's vehicles (posted by the extension after a sync). */
    public function ingest(Request $request): JsonResponse
    {
        $request->validate([
            'vehicles' => ['required', 'array'],
            'vehicles.*.uber_vehicle_uuid' => ['required', 'string'],
        ]);

        $tenantId = (int) $request->user()->tenant_id;
        $count = 0;

        // Use the raw input (validate() would strip the unlisted vehicle fields).
        foreach ($request->input('vehicles') as $v) {
            if (empty($v['uber_vehicle_uuid'])) {
                continue;
            }
            Vehicle::updateOrCreate(
                ['tenant_id' => $tenantId, 'uber_vehicle_uuid' => $v['uber_vehicle_uuid']],
                [
                    'make' => $v['make'] ?? null,
                    'model' => $v['model'] ?? null,
                    'year' => ! empty($v['year']) ? (int) $v['year'] : null,
                    'license_plate' => $v['license_plate'] ?? null,
                    'vin' => $v['vin'] ?? null,
                    'color' => $v['color'] ?? null,
                    'color_hex' => $v['color_hex'] ?? null,
                    'image_url' => $v['image_url'] ?? null,
                    'compliance_status' => $v['compliance_status'] ?? null,
                    'assigned_driver_uuid' => $v['assigned_driver_uuid'] ?? null,
                    'synced_at' => now(),
                ],
            );
            $count++;
        }

        return response()->json(['data' => ['synced' => $count]]);
    }
}
