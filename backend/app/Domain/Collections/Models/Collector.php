<?php

namespace App\Domain\Collections\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A cash collector the super-admin registers. Platform-level (not tenant-scoped):
 * any fleet can pay any collector. Aggregate figures are derived from its
 * payments, never stored.
 */
class Collector extends Model
{
    protected $fillable = ['name', 'phone', 'address'];

    public function payments(): HasMany
    {
        return $this->hasMany(CollectorPayment::class);
    }
}
