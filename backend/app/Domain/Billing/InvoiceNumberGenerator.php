<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\SubscriptionPeriod;
use Illuminate\Support\Facades\DB;

/**
 * Assigns the next per-year sequential invoice number to a period, e.g.
 * "RE-2026-0042". The sequence is computed under a row lock inside a
 * transaction so two concurrent activations can never claim the same number.
 */
class InvoiceNumberGenerator
{
    private const SEQUENCE_PAD = 4;

    /** Assign and persist the next number for the given prefix + year. */
    public function assign(SubscriptionPeriod $period, string $prefix, int $year): string
    {
        return DB::transaction(function () use ($period, $prefix, $year) {
            $pattern = $prefix.'-'.$year.'-%';

            // Lock the year's rows so a parallel activation waits for our sequence.
            $last = SubscriptionPeriod::query()
                ->where('invoice_no', 'like', $pattern)
                ->lockForUpdate()
                ->orderByDesc('invoice_no')
                ->value('invoice_no');

            $next = $last === null ? 1 : ((int) substr((string) $last, -self::SEQUENCE_PAD)) + 1;
            $number = sprintf('%s-%d-%0'.self::SEQUENCE_PAD.'d', $prefix, $year, $next);

            // Persist INSIDE the transaction so the winning number is written while
            // the row lock is still held. Writing it after commit (as before) left a
            // gap where two activations computed the same number — the loser then hit
            // the UNIQUE(invoice_no) constraint and 500'd. Most acute for the first
            // invoice of a year, when lockForUpdate matches zero rows and locks nothing.
            $period->forceFill(['invoice_no' => $number])->save();

            return $number;
        });
    }
}
