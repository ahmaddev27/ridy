<?php

namespace App\Domain\Tenancy\Models;

use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A residential proxy in the shared pool. `url` carries credentials, so it is
 * hidden and only ever surfaced masked to the admin.
 */
class Proxy extends Model
{
    protected $fillable = ['label', 'url', 'capacity', 'price', 'source', 'notes', 'starts_at', 'expires_at'];

    protected $hidden = ['url'];

    protected $casts = ['url' => 'encrypted', 'capacity' => 'integer', 'price' => 'decimal:2', 'starts_at' => 'date', 'expires_at' => 'date'];

    public function tenants(): HasMany
    {
        return $this->hasMany(Tenant::class);
    }

    /** Paid renewal periods (extensions on the same credentials), newest first. */
    public function renewals(): HasMany
    {
        return $this->hasMany(ProxyRenewal::class)->orderByDesc('ends_at');
    }

    /** The furthest end date across the base period and every renewal — the real expiry. */
    public function effectiveEndsAt(): ?Carbon
    {
        return $this->renewals->pluck('ends_at')->push($this->expires_at)->filter()->max();
    }

    /**
     * Whether the proxy is still within its paid period — the REAL expiry, which
     * includes paid renewals (extensions on the same credentials), not just the base
     * period. A proxy whose first period has passed but which was renewed is NOT
     * expired. No end set at all = treated as active (no known expiry).
     */
    public function isActive(?CarbonInterface $now = null): bool
    {
        $end = $this->effectiveEndsAt();

        return $end === null || $end->copy()->endOfDay()->greaterThanOrEqualTo($now ?? now());
    }

    /**
     * Whole days until the real (renewal-aware) expiry — negative once past it, null
     * when the proxy has no end date set. The single source of truth for the "expires
     * in N days" the admin overview, health report and expiry notification all show.
     */
    public function daysLeft(?CarbonInterface $now = null): ?int
    {
        $end = $this->effectiveEndsAt();

        return $end === null
            ? null
            : (int) ($now ?? now())->copy()->startOfDay()->diffInDays($end->copy()->startOfDay(), false);
    }

    /** Total spend on this proxy: the initial price plus every renewal amount. */
    public function totalPaid(): float
    {
        return (float) ($this->price ?? 0) + (float) $this->renewals->sum('amount');
    }

    /**
     * How many drivers currently occupy this proxy — the sum of drivers across
     * the active (usable) companies assigned to it. Capacity is measured in
     * drivers, since that's what drives the proxy's real load.
     */
    public function usedCount(): int
    {
        return Driver::withoutGlobalScopes()
            ->whereIn('tenant_id', Tenant::usable()->where('proxy_id', $this->id)->select('id'))
            ->count();
    }

    public function hasFreeSlot(): bool
    {
        return $this->usedCount() < $this->capacity;
    }
}
