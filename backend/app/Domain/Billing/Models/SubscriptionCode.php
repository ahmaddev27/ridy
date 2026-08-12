<?php

namespace App\Domain\Billing\Models;

use App\Domain\Collections\Models\Collector;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An issued activation code and its lifecycle. Status is derived, never stored,
 * so it stays correct as time passes.
 */
class SubscriptionCode extends Model
{
    protected $fillable = [
        'code', 'plan_id', 'tenant_id', 'collector_id', 'amount', 'paid',
        'expires_at', 'activated_at', 'subscription_period_id', 'created_by',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid' => 'boolean',
        'expires_at' => 'datetime',
        'activated_at' => 'datetime',
    ];

    /** pending (unused, still valid) | activated (company used it) | expired. */
    public function status(?CarbonImmutable $now = null): string
    {
        if ($this->activated_at !== null) {
            return 'activated';
        }

        return $this->expires_at->isBefore($now ?? CarbonImmutable::now()) ? 'expired' : 'pending';
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function collector(): BelongsTo
    {
        return $this->belongsTo(Collector::class);
    }
}
