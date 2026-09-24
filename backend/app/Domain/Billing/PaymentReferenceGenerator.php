<?php

namespace App\Domain\Billing;

use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Assigns a human-readable payment reference to an issued activation code, e.g.
 * "DIN-2026-0042" (first 3 letters of the company name + year + a per-prefix
 * sequence). Lets the admin reconcile an incoming bank transfer back to the
 * company/subscription. The sequence is computed under a row lock inside a
 * transaction so two concurrent code generations can't claim the same number
 * (mirrors {@see InvoiceNumberGenerator}).
 */
class PaymentReferenceGenerator
{
    private const SEQUENCE_PAD = 4;

    /** Assign, persist, and return the next reference for this company + year. */
    public function assign(SubscriptionCode $code, Tenant $tenant, int $year): string
    {
        $prefix = PaymentPrefix::from($tenant->name);

        return DB::transaction(function () use ($code, $prefix, $year) {
            $pattern = $prefix.'-'.$year.'-%';

            // Lock the prefix+year's rows so a parallel generation waits for our seq.
            // The max is taken NUMERICALLY: a string MAX stalls at "…-9999" (which
            // sorts above "…-10000") and would then collide on every later code.
            $head = $prefix.'-'.$year.'-';
            $last = SubscriptionCode::query()
                ->where('payment_ref', 'like', $pattern)
                ->lockForUpdate()
                ->pluck('payment_ref')
                ->map(fn (string $ref) => substr($ref, strlen($head)))
                ->filter(fn (string $seq) => ctype_digit($seq))
                ->map(fn (string $seq) => (int) $seq)
                ->max();

            $next = ($last ?? 0) + 1;
            $ref = sprintf('%s-%d-%0'.self::SEQUENCE_PAD.'d', $prefix, $year, $next);

            // Persist inside the transaction while the lock is held (see the invoice
            // generator's note on the first-of-year gap).
            $code->forceFill(['payment_ref' => $ref])->save();

            return $ref;
        });
    }
}
