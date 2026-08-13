<?php

namespace App\Domain\Collections\Models;

use App\Domain\Billing\Models\SubscriptionCode;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A cash collector the super-admin registers. Platform-level (not tenant-scoped):
 * any fleet can pay any collector. May optionally have a login (reseller User)
 * to issue activation codes. Aggregate figures are derived from its payments.
 */
class Collector extends Model
{
    protected $fillable = ['name', 'phone', 'address', 'user_id'];

    public function payments(): HasMany
    {
        return $this->hasMany(CollectorPayment::class);
    }

    /** Activation codes this collector issued — the source of their collected total. */
    public function subscriptionCodes(): HasMany
    {
        return $this->hasMany(SubscriptionCode::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
