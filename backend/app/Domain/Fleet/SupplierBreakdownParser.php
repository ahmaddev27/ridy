<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\FleetMetric;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;

/**
 * Parses Uber's fleet-level earnings summary (getSupplierBreakdownV2) — total
 * earnings, the cash drivers collected, and the net paid out to the company — into
 * a single latest snapshot per tenant (FleetMetric). The per-driver equivalent is
 * {@see EarnerBreakdownParser}. Money arrives as `amountE5` (÷100000).
 */
class SupplierBreakdownParser
{
    /** Whether the captured payload is a getSupplierBreakdownV2 response. */
    public static function handles(array $payload): bool
    {
        return Arr::get($payload, 'operationName') === 'getSupplierBreakdownV2'
            || Arr::has($payload, 'data.data.getSupplierBreakdownV2')
            || Arr::has($payload, 'data.getSupplierBreakdownV2');
    }

    /** Upsert the company's latest fleet earnings snapshot. Returns true when stored. */
    public function store(int $tenantId, array $payload): bool
    {
        $node = Arr::get($payload, 'data.data.getSupplierBreakdownV2')
            ?? Arr::get($payload, 'data.getSupplierBreakdownV2');
        if (! is_array($node)) {
            return false;
        }

        // Cash the drivers collected by hand (a negative payout line → keep the magnitude).
        $cash = 0.0;
        foreach (Arr::get($node, 'payouts.children', []) as $child) {
            if (($child['categoryName'] ?? null) === 'cash_collected') {
                $cash = abs($this->amount($child, 'amount'));
            }
        }

        // Flat {category => amount} of the top-level earnings lines (fare, promotion…).
        $breakdown = [];
        foreach (Arr::get($node, 'earnings.children', []) as $child) {
            $cat = $child['categoryName'] ?? null;
            if (is_string($cat) && $cat !== '') {
                $breakdown[$cat] = $this->amount($child, 'amount');
            }
        }

        FleetMetric::updateOrCreate(
            ['tenant_id' => $tenantId],
            [
                'earnings' => $this->amount($node, 'earnings.amount'),
                'net_outstanding' => $this->amount($node, 'endBalance'),
                'cash_collected' => $cash,
                'fare' => $breakdown['fare'] ?? null,
                'currency' => Arr::get($node, 'earnings.amount.currencyCode'),
                'breakdown' => $breakdown,
                'synced_at' => CarbonImmutable::now(),
            ],
        );

        return true;
    }

    /** `amountE5` at `<path>.amountE5` → currency units (÷100000). */
    private function amount(array $node, string $path): float
    {
        $e5 = Arr::get($node, $path.'.amountE5');

        return $e5 !== null ? round((float) $e5 / 100000, 2) : 0.0;
    }
}
