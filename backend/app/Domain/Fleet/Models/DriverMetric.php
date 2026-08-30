<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A driver's Uber performance metrics for one time window.
 */
class DriverMetric extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'driver_id', 'period_start', 'period_end',
        'earnings', 'net_outstanding', 'earnings_label', 'trips', 'distance_km',
        'hours_online', 'hours_on_trip', 'acceptance_rate', 'cancellation_rate',
        'breakdown', 'synced_at',
    ];

    protected $casts = [
        'period_start' => 'datetime',
        'period_end' => 'datetime',
        'earnings' => 'decimal:2',
        'net_outstanding' => 'decimal:2',
        'distance_km' => 'decimal:2',
        'breakdown' => 'array',
        'trips' => 'integer',
        'hours_online' => 'decimal:2',
        'hours_on_trip' => 'decimal:2',
        'acceptance_rate' => 'decimal:2',
        'cancellation_rate' => 'decimal:2',
        'synced_at' => 'datetime',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
