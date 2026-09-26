<?php

namespace App\Domain\Privacy;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Database\Eloquent\Builder;

/**
 * Strips the personal data out of dispatch offers while keeping the business
 * figures (fare, distance, status, timestamps, driver link) for statistics.
 *
 * Cleared: the rider's first name, the driver name captured in the payload,
 * every address/label/station, all coordinates, the route and stops, and the
 * raw Uber payload (which repeats all of the above). `anonymized_at` marks the
 * row so a run never touches it twice. Works in short id-bounded batches.
 */
class OfferAnonymizer
{
    private const BATCH = 1000;

    /** Column => value written by anonymization. */
    public const CLEARED = [
        'rider_first_name' => null,
        'driver_first_name' => null,
        'driver_last_name' => null,
        'pickup_address' => null,
        'dropoff_address' => null,
        'pickup_display' => null,
        'dropoff_display' => null,
        'pickup_station_name' => null,
        'dropoff_station_name' => null,
        'pickup_lat' => null,
        'pickup_lng' => null,
        'dropoff_lat' => null,
        'dropoff_lng' => null,
        'route_geometry' => null,
        'stops' => null,
        'raw_payload' => '{}',
    ];

    /**
     * Anonymize every offer received before $cutoff, tenant by tenant so each
     * batch walks the (tenant_id, received_at) index.
     *
     * @return int offers anonymized
     */
    public function olderThan(CarbonInterface $cutoff, bool $dryRun = false): int
    {
        // From the small tenants table — a DISTINCT over the offers would scan them all.
        $tenantIds = Tenant::query()->pluck('id');

        $total = 0;
        foreach ($tenantIds as $tenantId) {
            $total += $this->run(fn () => DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('received_at', '<', $cutoff)
                ->whereNull('anonymized_at'), $dryRun);
        }

        return $total;
    }

    /**
     * Anonymize the rows a query selects. `$extra` columns are written too (driver
     * erasure also unlinks the driver).
     *
     * @param  Closure(): Builder  $query  a fresh query; must exclude already-anonymized rows
     * @param  array<string, mixed>  $extra
     */
    public function run(Closure $query, bool $dryRun = false, array $extra = []): int
    {
        if ($dryRun) {
            return $query()->count();
        }

        $values = self::CLEARED + $extra + ['anonymized_at' => now()];
        $total = 0;

        do {
            $ids = $query()->orderBy('id')->limit(self::BATCH)->pluck('id');
            if ($ids->isEmpty()) {
                break;
            }
            $total += DispatchOffer::withoutGlobalScopes()->whereIntegerInRaw('id', $ids->all())->update($values);
        } while ($ids->count() === self::BATCH);

        return $total;
    }
}
