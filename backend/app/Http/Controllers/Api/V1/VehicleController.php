<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\SupplierNetworkRecorder;
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
    public function ingest(Request $request, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $request->validate([
            'vehicles' => ['required', 'array', 'max:2000'],
            'vehicles.*' => ['array'],
            'vehicles.*.uber_vehicle_uuid' => ['required', 'string', 'max:64'],
        ]);

        $tenantId = (int) $request->user()->tenant_id;
        $recorder->vehicles($tenantId, (array) $request->input('vehicles'));
        $count = 0;

        // Use the raw input (validate() would strip the unlisted vehicle fields),
        // but SANITIZE every field instead of rejecting the batch: a strict rule
        // would 422 the whole sync from the published extension over one odd
        // value, while an unsanitized array field 500'd (Array to string).
        foreach ($request->input('vehicles') as $v) {
            if (empty($v['uber_vehicle_uuid'])) {
                continue;
            }
            Vehicle::updateOrCreate(
                ['tenant_id' => $tenantId, 'uber_vehicle_uuid' => $v['uber_vehicle_uuid']],
                [
                    'make' => $this->text($v, 'make'),
                    'model' => $this->text($v, 'model'),
                    'year' => is_numeric($v['year'] ?? null) && (int) $v['year'] > 1900 && (int) $v['year'] < 2100 ? (int) $v['year'] : null,
                    'license_plate' => $this->text($v, 'license_plate', 32),
                    'vin' => $this->text($v, 'vin', 32),
                    'color' => $this->text($v, 'color', 64),
                    'color_hex' => preg_match('/^#?[0-9a-fA-F]{3,8}$/', (string) $this->text($v, 'color_hex', 9)) === 1 ? $this->text($v, 'color_hex', 9) : null,
                    // Rendered as <img src> for managers/admins: https only.
                    'image_url' => $this->httpsUrl($this->text($v, 'image_url', 2048)),
                    'compliance_status' => $this->text($v, 'compliance_status', 64),
                    'assigned_driver_uuid' => $this->text($v, 'assigned_driver_uuid', 64),
                    'synced_at' => now(),
                ],
            );
            $count++;
        }

        return response()->json(['data' => ['synced' => $count]]);
    }

    /** A scalar field as a trimmed string capped at $max chars, else null. */
    private function text(array $vehicle, string $key, int $max = 255): ?string
    {
        $value = $vehicle[$key] ?? null;
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function httpsUrl(?string $url): ?string
    {
        return $url !== null && str_starts_with(strtolower($url), 'https://') && filter_var($url, FILTER_VALIDATE_URL) !== false
            ? $url
            : null;
    }
}
