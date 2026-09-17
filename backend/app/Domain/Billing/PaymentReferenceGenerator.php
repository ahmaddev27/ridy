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
            $last = SubscriptionCode::query()
                ->where('payment_ref', 'like', $pattern)
                ->lockForUpdate()
                ->orderByDesc('payment_ref')
                ->value('payment_ref');

            $next = $last === null ? 1 : ((int) substr((string) $last, -self::SEQUENCE_PAD)) + 1;
            $ref = sprintf('%s-%d-%0'.self::SEQUENCE_PAD.'d', $prefix, $year, $next);

            // Persist inside the transaction while the lock is held (see the invoice
            // generator's note on the first-of-year gap).
            $code->forceFill(['payment_ref' => $ref])->save();

            return $ref;
        });
    }
}
