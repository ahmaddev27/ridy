<?php

namespace App\Domain\Billing\Models;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A paid subscription period ("invoice"), created when a company activates or
 * renews. Not tenant-scoped: the super-admin reads these across all companies
 * for billing reports.
 */
class SubscriptionPeriod extends Model
{
    protected $fillable = ['tenant_id', 'days', 'starts_at', 'ends_at'];

    protected $casts = [
        'days' => 'integer',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
