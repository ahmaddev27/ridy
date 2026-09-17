<?php

namespace App\Domain\Billing\Models;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A company's "I've paid" claim awaiting admin verification. Status is stored
 * (pending → confirmed | rejected); a rejection carries a reason shown to the
 * company. At most one pending claim per company (enforced in the service).
 */
class PaymentClaim extends Model
{
    protected $fillable = [
        'tenant_id', 'reference', 'status', 'reason', 'resolved_at', 'resolved_by',
    ];

    protected $casts = [
        'resolved_at' => 'datetime',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
