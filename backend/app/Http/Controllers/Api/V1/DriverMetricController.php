<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
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
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'driver_uuid' => ['required', 'string'],
            'period_start' => ['required', 'numeric'], // ms epoch
            'period_end' => ['required', 'numeric'],
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

        $metric = DriverMetric::updateOrCreate(
            [
                'driver_id' => $driver->id,
                'period_start' => CarbonImmutable::createFromTimestampMs($data['period_start']),
                'period_end' => CarbonImmutable::createFromTimestampMs($data['period_end']),
            ],
            [
                'tenant_id' => $driver->tenant_id,
                'earnings' => $data['earnings'] ?? null,
                'earnings_label' => $data['earnings_label'] ?? null,
                'trips' => $data['trips'] ?? null,
                'hours_online' => $data['hours_online'] ?? null,
                'hours_on_trip' => $data['hours_on_trip'] ?? null,
                'acceptance_rate' => $data['acceptance_rate'] ?? null,
                'cancellation_rate' => $data['cancellation_rate'] ?? null,
                'synced_at' => now(),
            ],
        );

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
