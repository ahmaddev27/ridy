<?php

namespace App\Domain\Collections\Models;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One cash payment from a fleet to a collector. The collector is chosen per
 * payment, so this row — not any fleet column — is the source of truth for who
 * collected what.
 */
class CollectorPayment extends Model
{
    protected $fillable = ['collector_id', 'tenant_id', 'amount', 'paid_on', 'note', 'created_by'];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid_on' => 'date',
    ];

    public function collector(): BelongsTo
    {
        return $this->belongsTo(Collector::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
