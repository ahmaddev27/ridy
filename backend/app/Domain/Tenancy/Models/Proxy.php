<?php

namespace App\Domain\Tenancy\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A residential proxy in the shared pool. `url` carries credentials, so it is
 * hidden and only ever surfaced masked to the admin.
 */
class Proxy extends Model
{
    protected $fillable = ['label', 'url', 'capacity', 'price', 'source', 'notes', 'expires_at'];

    protected $hidden = ['url'];

    protected $casts = ['capacity' => 'integer', 'price' => 'decimal:2', 'expires_at' => 'date'];

    public function tenants(): HasMany
    {
        return $this->hasMany(Tenant::class);
    }

    /** How many active (usable) companies currently occupy this proxy. */
    public function usedCount(): int
    {
        return Tenant::usable()->where('proxy_id', $this->id)->count();
    }

    public function hasFreeSlot(): bool
    {
        return $this->usedCount() < $this->capacity;
    }
}
