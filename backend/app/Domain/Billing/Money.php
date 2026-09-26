<?php

namespace App\Domain\Billing;

/**
 * Money math in integer cents, so sums and comparisons of decimal(…,2) amounts
 * never drift the way float addition does.
 */
final class Money
{
    /** A decimal amount ("149.00", 149, null) as integer cents. */
    public static function cents(float|int|string|null $amount): int
    {
        return (int) round(((float) $amount) * 100);
    }

    /** Integer cents back to a 2-decimal float for JSON responses. */
    public static function toFloat(int $cents): float
    {
        return round($cents / 100, 2);
    }
}
