<?php

namespace App\Support;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

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

    /**
     * Only plain arrays/scalars go into the cache: config/cache.php sets
     * serializable_classes=false, so a cached Collection comes back from the
     * DB store as __PHP_Incomplete_Class. The ".v2" keys skip entries that the
     * first (Collection-caching) version already wrote.
     */
    private const OFFERS_BY_TENANT_KEY = 'platform.offers_by_tenant.v2';

    private const OFFERS_TOTAL_KEY = 'platform.offers_total.v2';

    private const DRIVERS_BY_TENANT_KEY = 'platform.drivers_by_tenant.v2';

    private const OFFERS_DAILY_KEY = 'platform.offers_daily.v1';

    /** Offer count per tenant, keyed by tenant_id. */
    public function offersByTenant(): Collection
    {
        return collect(Cache::remember(self::OFFERS_BY_TENANT_KEY, self::TTL_SECONDS, fn () => DispatchOffer::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id')->all()));
    }

    /** Total offers captured across the whole platform. */
    public function totalOffers(): int
    {
        return (int) Cache::remember(self::OFFERS_TOTAL_KEY, self::TTL_SECONDS, fn () => DispatchOffer::withoutGlobalScopes()->count());
    }

    /**
     * Offers per fleet-day (04:00 → 04:00) since $since, as a plain
     * ['Y-m-d' => count] array. Grouped by the raw expression (not its alias) so
     * it runs on MySQL and SQLite alike.
     *
     * @return array<string, int>
     */
    public function offersDaily(CarbonInterface $since): array
    {
        $key = self::OFFERS_DAILY_KEY.':'.$since->format('Y-m-d');

        return Cache::remember($key, self::TTL_SECONDS, function () use ($since) {
            $day = FleetDay::dateExpr('received_at');

            return DispatchOffer::withoutGlobalScopes()
                ->where('received_at', '>=', $since)
                ->groupBy(DB::raw($day))
                ->pluck(DB::raw('count(*) as c'), DB::raw("{$day} as day"))
                ->map(fn ($c) => (int) $c)
                ->all();
        });
    }

    /** Drop the cached counts so a structural change (e.g. a deleted company) shows at once. */
    public function forget(): void
    {
        Cache::forget(self::OFFERS_BY_TENANT_KEY);
        Cache::forget(self::OFFERS_TOTAL_KEY);
        Cache::forget(self::DRIVERS_BY_TENANT_KEY);
        Cache::forget(self::OFFERS_DAILY_KEY.':'.FleetDay::startDaysAgo(13)->format('Y-m-d'));
    }

    /** Driver count per tenant, keyed by tenant_id. */
    public function driversByTenant(): Collection
    {
        return collect(Cache::remember(self::DRIVERS_BY_TENANT_KEY, self::TTL_SECONDS, fn () => Driver::withoutGlobalScopes()
            ->selectRaw('tenant_id, count(*) c')->groupBy('tenant_id')->pluck('c', 'tenant_id')->all()));
    }
}
