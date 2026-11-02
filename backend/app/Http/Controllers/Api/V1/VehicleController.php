<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\FleetHub\VehicleIngestService;
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
    public function ingest(Request $request, VehicleIngestService $service): JsonResponse
    {
        $request->validate([
            'vehicles' => ['required', 'array', 'max:2000'],
            'vehicles.*' => ['array'],
            'vehicles.*.uber_vehicle_uuid' => ['required', 'string', 'max:64'],
        ]);

        // The raw input, not validate()'s output (which would strip the unlisted
        // vehicle fields); the service sanitizes every field.
        $count = $service->ingest((int) $request->user()->tenant_id, (array) $request->input('vehicles'));

        return response()->json(['data' => ['synced' => $count]]);
    }
}
