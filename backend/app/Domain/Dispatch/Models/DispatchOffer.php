<?php

namespace App\Domain\Dispatch\Models;

use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
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
        'pickup_address', 'dropoff_address', 'pickup_display', 'dropoff_display', 'pickup_station_name', 'dropoff_station_name',
        'fare_formatted', 'accept_window_seconds',
        'requested_at', 'offer_generated_at', 'received_at', 'accepted_at', 'raw_payload',
        'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
        'distance_m', 'route_geometry', 'geo_confidence', 'geo_source', 'stops', 'stops_count', 'geo_synced_at', 'geo_attempts',
        'status', 'fare_amount', 'started_at', 'completed_at', 'rejected_at', 'canceled_at',
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
        'stops' => 'array',
        'stops_count' => 'integer',
        'geo_synced_at' => 'datetime',
        'geo_attempts' => 'integer',
        'status' => OfferStatus::class,
        'fare_amount' => 'decimal:2',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
        'rejected_at' => 'datetime',
        'canceled_at' => 'datetime',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * The status to show. A stored PENDING whose accept window has elapsed reads
     * as REJECTED even before the expiry sweep runs — so the UI is never stuck on
     * "pending" (e.g. a new offer to an already-on-trip driver that was never taken).
     */
    public function displayStatus(): OfferStatus
    {
        if ($this->status === OfferStatus::Pending && $this->received_at !== null) {
            $deadline = $this->received_at->addSeconds((int) ($this->accept_window_seconds ?? 0) + 30);
            if ($deadline->isBefore(now())) {
                return OfferStatus::Rejected;
            }
        }

        return $this->status ?? OfferStatus::Pending;
    }

    /** Offers that were ever accepted (taken), regardless of final state. */
    public function scopeTaken(Builder $query): Builder
    {
        return $query->whereNotNull('accepted_at');
    }

    public function scopeCompleted(Builder $query): Builder
    {
        return $query->where('status', OfferStatus::Completed);
    }
}
