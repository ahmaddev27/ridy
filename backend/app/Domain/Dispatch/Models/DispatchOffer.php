<?php

namespace App\Domain\Dispatch\Models;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single ride offer captured from the Uber fleet dispatch (RAMEN) stream,
 * routed to a driver by driverUUID. Stores the full captured detail.
 */
class DispatchOffer extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'driver_uuid', 'driver_id', 'offer_uuid', 'real_offer_uuid',
        'partner_uuid', 'seq', 'rider_first_name', 'driver_first_name', 'driver_last_name',
        'pickup_address', 'dropoff_address', 'fare_formatted', 'accept_window_seconds',
        'requested_at', 'offer_generated_at', 'received_at', 'accepted_at', 'raw_payload',
        'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
        'distance_m', 'route_geometry', 'geo_synced_at',
    ];

    protected $casts = [
        'seq' => 'integer',
        'accept_window_seconds' => 'integer',
        'requested_at' => 'datetime',
        'offer_generated_at' => 'datetime',
        'received_at' => 'datetime',
        'accepted_at' => 'datetime',
        'raw_payload' => 'array',
        'pickup_lat' => 'float',
        'pickup_lng' => 'float',
        'dropoff_lat' => 'float',
        'dropoff_lng' => 'float',
        'distance_m' => 'integer',
        'route_geometry' => 'array',
        'geo_synced_at' => 'datetime',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
