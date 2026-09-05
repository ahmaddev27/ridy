<?php

namespace App\Domain\Tenancy\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One paid renewal period of a {@see Proxy} — the invoice was paid again on the
 * same credentials for another span (amount + start/end). The proxy's spend is
 * the sum of these plus its initial price.
 */
class ProxyRenewal extends Model
{
    protected $fillable = ['amount', 'starts_at', 'ends_at', 'note'];

    protected $casts = ['amount' => 'decimal:2', 'starts_at' => 'date', 'ends_at' => 'date'];

    public function proxy(): BelongsTo
    {
        return $this->belongsTo(Proxy::class);
    }
}
