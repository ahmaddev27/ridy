<?php

namespace App\Domain\Fleet\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A company-level roll-up of Uber's official earnings (getSupplierBreakdownV2):
 * total earnings, cash the drivers collected, and the net paid out to the fleet.
 * One latest snapshot per tenant (upserted on capture).
 */
class FleetMetric extends Model
{
    protected $fillable = [
        'tenant_id', 'earnings', 'net_outstanding', 'cash_collected', 'fare',
        'currency', 'breakdown', 'synced_at',
    ];

    protected $casts = [
        'earnings' => 'decimal:2',
        'net_outstanding' => 'decimal:2',
        'cash_collected' => 'decimal:2',
        'fare' => 'decimal:2',
        'breakdown' => 'array',
        'synced_at' => 'datetime',
    ];
}
