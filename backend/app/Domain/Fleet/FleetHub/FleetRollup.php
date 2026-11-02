<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\Models\FleetMetric;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;

/**
 * Computes the company-level FleetMetric snapshot from the per-earner rows the
 * earnings sync already fetched (getEarnerBreakdownsV2), so no second Uber call
 * is needed.
 *
 * DOCUMENTED FALLBACK: this is a sum-of-earners approximation. The extension
 * stores Uber's own getSupplierBreakdownV2 (query text not captured server
 * side), whose figures - notably `endBalance` (here: summed netOutstanding) -
 * can differ slightly. Whichever path ran last wins the single tenant row.
 */
class FleetRollup
{
    /** @param  list<array<string, mixed>>  $earners */
    public function store(int $tenantId, array $earners): bool
    {
        if ($earners === []) {
            return false; // never replace a real snapshot with zeros
        }

        $earnings = $net = $cash = 0.0;
        $breakdown = [];
        $currency = null;

        foreach ($earners as $earner) {
            $earnings += $this->amount($earner, 'earnings.amount');
            $net += $this->amount($earner, 'netOutstanding');
            $currency ??= Arr::get($earner, 'earnings.amount.currencyCode');
            foreach (Arr::get($earner, 'earnings.children', []) as $child) {
                $cat = $child['categoryName'] ?? null;
                if (is_string($cat) && $cat !== '') {
                    $breakdown[$cat] = ($breakdown[$cat] ?? 0.0) + $this->amount($child, 'amount');
                }
            }
            foreach (Arr::get($earner, 'payouts.children', []) as $child) {
                if (($child['categoryName'] ?? null) === 'cash_collected') {
                    $cash += abs($this->amount($child, 'amount'));
                }
            }
        }

        FleetMetric::updateOrCreate(['tenant_id' => $tenantId], [
            'earnings' => round($earnings, 2),
            'net_outstanding' => round($net, 2),
            'cash_collected' => round($cash, 2),
            'fare' => isset($breakdown['fare']) ? round($breakdown['fare'], 2) : null,
            'currency' => is_string($currency) ? $currency : null,
            'breakdown' => array_map(fn (float $v) => round($v, 2), $breakdown),
            'synced_at' => CarbonImmutable::now(),
        ]);

        return true;
    }

    /** `amountE5` at `<path>.amountE5` -> currency units. */
    private function amount(array $node, string $path): float
    {
        return round((float) Arr::get($node, $path.'.amountE5', 0) / 100000, 2);
    }
}
