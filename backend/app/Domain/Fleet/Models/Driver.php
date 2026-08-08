<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Driver extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id', 'name', 'phone', 'license_no', 'employment_type', 'external_ids', 'pseudonym_id',
        'uber_driver_uuid', 'uber_email', 'uber_link_method',
        'uber_picture_url', 'uber_rating', 'uber_total_trips', 'uber_status', 'roster_synced_at',
    ];

    protected $casts = [
        'external_ids' => 'array',
        'uber_rating' => 'decimal:2',
        'uber_total_trips' => 'integer',
        'roster_synced_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        // Assign a stable pseudonym used in analytics so driver identity is not exposed.
        static::creating(function (Driver $driver) {
            if (empty($driver->pseudonym_id)) {
                $driver->pseudonym_id = 'DRV-'.strtoupper(Str::random(6));
            }
        });
    }
}
