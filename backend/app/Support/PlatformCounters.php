<?php

namespace App\Support;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * Read-through cache for the platform-wide aggregate counts the super-admin
 * pages render. The admin Overview and Company list both need a full COUNT(*)
 * and a GROUP BY tenant_id COUNT(*) over the ever-growing dispatch_offers
 * table; recomputing those on every page load scans millions of rows per view.
 * Admin aggregates tolerate ~1 minute of staleness, so caching collapses the
 * per-request full-table scan into at most one scan per minute, shared across
 * every admin and container through the DB-backed cache store.
 */
class PlatformCounters
{
    private const TTL_SECONDS = 60;

    /** Offer count per tenant, keyed by tenant_id. */
    public function offersByTenant(): Collection
    {
        return Cache::remember('platform.offers_by_tenant', self::TTL_SECONDS, fn () => DispatchOffer::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id'));
    }

    /** Total offers captured across the whole platform. */
    public function totalOffers(): int
    {
        return (int) Cache::remember('platform.offers_total', self::TTL_SECONDS, fn () => DispatchOffer::withoutGlobalScopes()->count());
    }

    /** Driver count per tenant, keyed by tenant_id. */
    public function driversByTenant(): Collection
    {
        return Cache::remember('platform.drivers_by_tenant', self::TTL_SECONDS, fn () => Driver::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id'));
    }
}
