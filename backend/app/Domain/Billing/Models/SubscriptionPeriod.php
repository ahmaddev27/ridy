<?php

namespace App\Domain\Billing\Models;

use App\Domain\Collections\Models\CollectorPayment;
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
    protected $fillable = ['tenant_id', 'days', 'amount', 'paid_at', 'collector_payment_id', 'starts_at', 'ends_at'];

    protected $casts = [
        'days' => 'integer',
        'amount' => 'decimal:2',
        'paid_at' => 'datetime',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    public function isPaid(): bool
    {
        return $this->paid_at !== null;
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function collectorPayment(): BelongsTo
    {
        return $this->belongsTo(CollectorPayment::class);
    }
}
