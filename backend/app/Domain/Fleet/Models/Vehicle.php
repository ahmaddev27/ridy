<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A fleet vehicle synced from Uber (SearchVehicles).
 */
class Vehicle extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'uber_vehicle_uuid', 'make', 'model', 'year',
        'license_plate', 'vin', 'color', 'color_hex', 'image_url',
        'compliance_status', 'assigned_driver_uuid', 'synced_at',
    ];

    protected $casts = [
        'year' => 'integer',
        'synced_at' => 'datetime',
    ];

    /** The driver Uber assigned this vehicle to (by Uber UUID), if any. */
    public function assignedDriver(): BelongsTo
    {
        return $this->belongsTo(Driver::class, 'assigned_driver_uuid', 'uber_driver_uuid');
    }
}
