<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Support\EpochTime;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;

/**
 * Parses Uber's getEarnerBreakdownsV2 capture (the Fleet Earnings page) into
 * per-driver {@see DriverMetric} rows: total earnings, trips, distance, net
 * outstanding, and the category breakdown (fare / promotion / tip / service fee /
 * cash collected). Uber sends money as `amountE5` — hundred-thousandths of the
 * currency unit — so every amount is divided by 100000.
 */
class EarnerBreakdownParser
{
    /** True when a captured payload is a getEarnerBreakdownsV2 response. */
    public static function handles(array $payload): bool
    {
        return Arr::get($payload, 'operationName') === 'getEarnerBreakdownsV2'
            || Arr::has($payload, 'data.data.getEarnerBreakdownsV2')
            || Arr::has($payload, 'data.getEarnerBreakdownsV2');
    }

    /**
     * @param  array<string, mixed>  $payload  the captured {operationName, variables, data}
     * @return int number of driver metrics upserted
     */
    public function parse(int $tenantId, array $payload): int
    {
        // The capture wraps the whole graphql response under `data`, so the real
        // payload lives at data.data (graphql's own `data` envelope). Fall back to
        // data.* for an already-unwrapped shape.
        $gql = Arr::get($payload, 'data.data', Arr::get($payload, 'data', []));
        $earners = Arr::get($gql, 'getEarnerBreakdownsV2.earnerEarningsBreakdowns');
        if (! is_array($earners) || $earners === []) {
            return 0;
        }

        [$start, $end] = $this->period($payload);

        // Resolve every earner's driver in ONE query and write all metrics in ONE
        // upsert — a 200-driver capture used to cost ~600 queries on the request.
        $byUuid = [];
        foreach ($earners as $earner) {
            $uuid = is_array($earner) ? Arr::get($earner, 'earnerUuid') : null;
            if (is_string($uuid) && $uuid !== '') {
                $byUuid[$uuid] = $earner;
            }
        }
        if ($byUuid === []) {
            return 0;
        }

        $driverIds = [];
        foreach (array_chunk(array_keys($byUuid), 500) as $chunk) {
            $driverIds += Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereIn('uber_driver_uuid', $chunk)
                ->pluck('id', 'uber_driver_uuid')
                ->all();
        }

        // upsert() bypasses model casts: dates and JSON are formatted by hand, the
        // dates exactly as Eloquent stores them so the unique key matches on re-sync.
        $now = CarbonImmutable::now();
        $rows = [];
        foreach ($byUuid as $uuid => $earner) {
            $driverId = $driverIds[$uuid] ?? null;
            if ($driverId === null) {
                continue; // an earner we don't track
            }

            $rows[] = [
                'driver_id' => $driverId,
                'period_start' => $start->format('Y-m-d H:i:s'),
                'period_end' => $end->format('Y-m-d H:i:s'),
                'tenant_id' => $tenantId,
                'earnings' => $this->amount($earner, 'earnings.amount'),
                'net_outstanding' => $this->amount($earner, 'netOutstanding'),
                'earnings_label' => $this->label($earner),
                'trips' => $this->tripInfo($earner, 'TRIP_ATTRIBUTE_NAME_COUNT'),
                'distance_km' => $this->distanceKm($earner),
                'breakdown' => json_encode($this->breakdown($earner)),
                'synced_at' => $now->format('Y-m-d H:i:s'),
            ];
        }

        if ($rows !== []) {
            DriverMetric::withoutGlobalScopes()->upsert(
                $rows,
                ['driver_id', 'period_start', 'period_end'],
                ['tenant_id', 'earnings', 'net_outstanding', 'earnings_label', 'trips', 'distance_km', 'breakdown', 'synced_at'],
            );
        }

        return count($rows);
    }

    private function label(array $earner): ?string
    {
        $code = Arr::get($earner, 'earnings.amount.currencyCode');

        return is_scalar($code) ? (string) $code : null;
    }

    /** {startTime,endTime} from the request variables, defaulting to this week. */
    private function period(array $payload): array
    {
        $tr = Arr::get($payload, 'variables.timeRange', []);
        $startMs = Arr::get($tr, 'startTimeUnixMillis');
        $endMs = Arr::get($tr, 'endTimeUnixMillis');

        // Berlin wall-clock like every other column (EpochTime), not Carbon's UTC.
        $start = EpochTime::fromMs($startMs) ?? CarbonImmutable::now()->startOfWeek();
        $end = EpochTime::fromMs($endMs) ?? CarbonImmutable::now();

        return [$start, $end];
    }

    /** `amountE5` at `<path>.amountE5` → currency units (÷100000). */
    private function amount(array $earner, string $path): ?float
    {
        $e5 = Arr::get($earner, $path.'.amountE5');

        return $e5 !== null ? round((float) $e5 / 100000, 2) : null;
    }

    private function tripInfo(array $earner, string $name): ?int
    {
        foreach (Arr::get($earner, 'tripInfos', []) as $t) {
            if (($t['tripAttributeName'] ?? null) === $name) {
                return (int) ($t['value'] ?? 0);
            }
        }

        return null;
    }

    /** Parse "993.21 km" → 993.21 from the DISTRANCE trip attribute (Uber's spelling). */
    private function distanceKm(array $earner): ?float
    {
        foreach (Arr::get($earner, 'tripInfos', []) as $t) {
            if (str_contains((string) ($t['tripAttributeName'] ?? ''), 'DISTRANCE')
                && preg_match('/[\d.]+/', (string) ($t['value'] ?? ''), $m) === 1) {
                return (float) $m[0];
            }
        }

        return null;
    }

    /**
     * A flat {categoryName => amount} of the top-level earnings categories (fare,
     * service_fee, promotion, tip) plus the payout lines (cash_collected).
     *
     * @return array<string, float>
     */
    private function breakdown(array $earner): array
    {
        $out = [];
        foreach (['earnings.children', 'payouts.children'] as $path) {
            foreach (Arr::get($earner, $path, []) as $child) {
                $cat = $child['categoryName'] ?? null;
                if (is_string($cat) && $cat !== '') {
                    $out[$cat] = round((float) ($child['amount']['amountE5'] ?? 0) / 100000, 2);
                }
            }
        }

        return $out;
    }
}
