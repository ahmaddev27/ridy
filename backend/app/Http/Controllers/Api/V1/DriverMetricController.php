<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\DriverMetricWriter;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Per-driver Uber performance metrics. Ingested from the browser extension
 * (which calls supplier GetEarnerMetrics with the manager's own session) and
 * read back for the driver detail view.
 */
class DriverMetricController extends Controller
{
    use AuthorizesTenantResource;

    /** Upsert a driver's metrics for a window (posted by the extension). */
    public function store(Request $request, SupplierNetworkRecorder $recorder, DriverMetricWriter $writer): JsonResponse
    {
        $data = $request->validate([
            'driver_uuid' => ['required', 'string'],
            // ms epoch, from 2000 on (EpochTime rejects anything earlier)
            'period_start' => ['required', 'numeric', 'min:946684800000'],
            'period_end' => ['required', 'numeric', 'min:946684800000'],
            'earnings' => ['nullable', 'numeric'],
            'earnings_label' => ['nullable', 'string', 'max:16'],
            'trips' => ['nullable', 'integer'],
            'hours_online' => ['nullable', 'numeric'],
            'hours_on_trip' => ['nullable', 'numeric'],
            'acceptance_rate' => ['nullable', 'numeric'],
            'cancellation_rate' => ['nullable', 'numeric'],
        ]);

        $driver = Driver::where('uber_driver_uuid', $data['driver_uuid'])->first();
        if ($driver === null) {
            return response()->json(['message' => 'Unknown driver.'], 404);
        }

        $recorder->metric((int) $driver->tenant_id, $data, $driver->name);

        $metric = $writer->write($driver, $data);

        return response()->json(['data' => $metric]);
    }

    /** Recent metric windows for one driver (newest first). */
    public function index(Driver $driver): JsonResponse
    {
        $this->authorizeTenant($driver);

        $metrics = DriverMetric::where('driver_id', $driver->id)
            ->orderByDesc('period_end')
            ->limit(12)
            ->get();

        return response()->json(['data' => $metrics]);
    }
}
