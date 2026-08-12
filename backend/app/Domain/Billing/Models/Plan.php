<?php

namespace App\Domain\Billing\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A subscription plan (name + price + duration). Resellers issue activation codes
 * against a plan, so the amount and length are fixed by the admin, not typed.
 */
class Plan extends Model
{
    protected $fillable = ['name', 'price', 'duration_days', 'active'];

    protected $casts = [
        'price' => 'decimal:2',
        'duration_days' => 'integer',
        'active' => 'boolean',
    ];
}
