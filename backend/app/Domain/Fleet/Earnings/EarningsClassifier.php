<?php

namespace App\Domain\Fleet\Earnings;

use UnexpectedValueException;

/**
 * Sorts one earner of Uber's getEarnerBreakdownsV2 into fare / promotion / tips /
 * cash, in integer E5 (hundred-thousandths of the currency unit).
 *
 * This is a literal port of the fleet owner's own console script, which is the
 * reference El-Professor's figures are checked against, so the rules below are
 * his and not ours to improve:
 *  - a node's category decides the bucket and its children inherit it;
 *  - a node with children is counted only by what the children do not account
 *    for (its "residual"), so a total and its parts are never both added;
 *  - cash is subtracted: Uber lists what the driver collected as a payout.
 *
 * Integers throughout. The script used BigInt for the same reason: a float
 * would reintroduce the rounding E5 exists to avoid. Nothing is divided here.
 */
final class EarningsClassifier
{
    /**
     * @param  array<string, mixed>  $earner  one element of earnerEarningsBreakdowns
     */
    public function classify(array $earner): EarnerFigures
    {
        $result = ['fare' => 0, 'promotion' => 0, 'tips' => 0, 'cash' => 0];

        $this->walk($earner['earnings'] ?? null, $result, 'fare');
        $this->walk($earner['payouts'] ?? null, $result, 'fare');
        $this->walk($earner['adjustmentsFromPreviousPeriods'] ?? null, $result, 'fare');
        $result['fare'] += $this->amount($earner['reimbursements'] ?? null);

        return new EarnerFigures(
            fare: $result['fare'],
            promotion: $result['promotion'],
            tips: $result['tips'],
            cash: $result['cash'],
            netOutstanding: $this->amount($earner['netOutstanding'] ?? null),
            trips: $this->trips($earner),
            currency: $this->currency($earner),
        );
    }

    /**
     * @param  array<string, int>  $result
     */
    private function walk(mixed $node, array &$result, string $inherited): void
    {
        if (! is_array($node)) {
            return;
        }

        $type = $this->bucket(strtolower((string) ($node['categoryName'] ?? '')), $inherited);
        $children = is_array($node['children'] ?? null) ? $node['children'] : [];

        if ($children === []) {
            $result[$type] += $this->signed($type, $this->amount($node));

            return;
        }

        $childTotal = 0;
        foreach ($children as $child) {
            $this->walk($child, $result, $type);
            $childTotal += $this->amount(is_array($child) ? $child : null);
        }

        $residual = $this->amount($node) - $childTotal;
        if ($residual !== 0) {
            $result[$type] += $this->signed($type, $residual);
        }
    }

    private function bucket(string $name, string $inherited): string
    {
        return match (true) {
            $name === 'promotion', str_starts_with($name, 'quest') => 'promotion',
            $name === 'tip' => 'tips',
            $name === 'payouts', $name === 'cash_collected' => 'cash',
            $name === 'fare', $name === 'little_fare', $name === 'service_fee' => 'fare',
            default => $inherited,
        };
    }

    private function signed(string $type, int $e5): int
    {
        return $type === 'cash' ? -$e5 : $e5;
    }

    /** @param  array<string, mixed>|null  $node */
    private function amount(?array $node): int
    {
        return $this->integer($node['amount']['amountE5'] ?? $node['amountE5'] ?? null);
    }

    /**
     * Refuses what is not a whole number rather than reading it as 0: a figure
     * that cannot be read must stop the pull, not turn into a quiet zero.
     */
    private function integer(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return 0;
        }
        if (is_int($raw)) {
            return $raw;
        }
        if (is_string($raw) && preg_match('/^-?\d{1,18}$/', $raw) === 1) {
            return (int) $raw;
        }

        throw new UnexpectedValueException('Uber returned an amount that is not a whole E5 number.');
    }

    /** @param  array<string, mixed>  $earner */
    private function trips(array $earner): ?int
    {
        foreach ($earner['tripInfos'] ?? [] as $info) {
            if (($info['tripAttributeName'] ?? null) !== 'TRIP_ATTRIBUTE_NAME_COUNT') {
                continue;
            }
            $value = $info['value'] ?? null;

            return is_numeric($value) && (string) (int) $value === (string) $value ? (int) $value : null;
        }

        return null;
    }

    /** @param  array<string, mixed>  $earner */
    private function currency(array $earner): ?string
    {
        $code = $earner['netOutstanding']['currencyCode'] ?? $earner['earnings']['amount']['currencyCode'] ?? null;

        return is_string($code) && $code !== '' ? $code : null;
    }
}
