<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Support\EpochTime;

/**
 * The one place a driver's Uber performance metrics are written, shared by the
 * extension ingest (DriverMetricController) and the server-side Fleet Hub sync.
 */
class DriverMetricWriter
{
    /**
     * @param  array<string, mixed>  $data  metric fields incl. period_start/period_end (epoch ms)
     */
    public function write(Driver $driver, array $data): DriverMetric
    {
        return DriverMetric::updateOrCreate(
            [
                'driver_id' => $driver->id,
                // Berlin wall-clock like every other column, not Carbon's UTC.
                'period_start' => EpochTime::fromMs($data['period_start']),
                'period_end' => EpochTime::fromMs($data['period_end']),
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
    }
}
