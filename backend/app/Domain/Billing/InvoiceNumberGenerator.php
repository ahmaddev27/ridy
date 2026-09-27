<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\SubscriptionPeriod;
use Illuminate\Support\Facades\DB;

/**
 * Assigns the next per-year sequential invoice number to a period, e.g.
 * "RE-2026-0042". The sequence lives in `invoice_sequences` (one row per prefix +
 * year) and is incremented under a lock on that single existing row, so:
 *  - two concurrent activations never claim the same number (and the first
 *    invoice of a year no longer races on an empty-range gap lock);
 *  - a number is never reused, even if a period row is later removed;
 *  - it keeps counting past 9999 (the old lexicographic MAX stalled there).
 */
class InvoiceNumberGenerator
{
    private const SEQUENCE_PAD = 4;

    /** Assign and persist the next number for the given prefix + year. */
    public function assign(SubscriptionPeriod $period, string $prefix, int $year): string
    {
        return DB::transaction(function () use ($period, $prefix, $year) {
            // Seed the counter on first use from any numbers already issued under
            // this prefix/year (invoices issued before the counter table existed).
            $counter = DB::table('invoice_sequences')->where('prefix', $prefix)->where('year', $year);
            if (! $counter->clone()->exists()) {
                DB::table('invoice_sequences')->insertOrIgnore([
                    'prefix' => $prefix,
                    'year' => $year,
                    'last_no' => $this->highestIssued($prefix, $year),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $next = (int) $counter->clone()->lockForUpdate()->value('last_no') + 1;
            $counter->clone()->update(['last_no' => $next, 'updated_at' => now()]);

            $number = sprintf('%s-%d-%0'.self::SEQUENCE_PAD.'d', $prefix, $year, $next);

            // Persist inside the transaction, while the counter row is locked.
            $period->forceFill(['invoice_no' => $number])->save();

            return $number;
        });
    }

    /** The highest numeric sequence already issued for this prefix/year (0 if none). */
    private function highestIssued(string $prefix, int $year): int
    {
        $head = $prefix.'-'.$year.'-';

        return SubscriptionPeriod::query()
            ->where('invoice_no', 'like', $head.'%')
            ->pluck('invoice_no')
            // LIKE treats `_`/`%` in a custom prefix as wildcards — re-check exactly.
            ->filter(fn (string $no) => str_starts_with($no, $head))
            ->map(fn (string $no) => substr($no, strlen($head)))
            ->filter(fn (string $seq) => ctype_digit($seq))
            ->map(fn (string $seq) => (int) $seq)
            ->max() ?? 0;
    }
}
