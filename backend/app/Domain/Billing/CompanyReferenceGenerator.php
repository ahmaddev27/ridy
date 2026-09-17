<?php

namespace App\Domain\Billing;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * The company's STABLE, customer-facing payment reference, e.g. "REIDEY-JAB-4821"
 * (brand + the company's 3-letter code + random digits). Unlike the per-code
 * {@see PaymentReferenceGenerator} (an internal, sequential code↔invoice link),
 * this one:
 *   - is assigned once per company and never changes, so the company can quote it,
 *   - is shown to the company BEFORE paying (on the "how to pay" screen + in the
 *     bank-transfer QR's remittance field) so every incoming transfer carries a
 *     token that maps to exactly one company — the admin reconciles the real bank
 *     transfer to the company before issuing the activation code,
 *   - uses random (not sequential) digits so it can't be guessed from the company
 *     id or the year.
 */
class CompanyReferenceGenerator
{
    private const PREFIX = 'REIDEY';

    private const MAX_ATTEMPTS = 20;

    /** Return the company's reference, generating + persisting it once if absent. */
    public function assign(Tenant $tenant): string
    {
        if ($tenant->payment_reference !== null) {
            return $tenant->payment_reference;
        }

        return DB::transaction(function () use ($tenant) {
            // Lock the row so two concurrent first-views can't assign twice.
            $locked = Tenant::whereKey($tenant->id)->lockForUpdate()->first();
            if ($locked->payment_reference !== null) {
                $tenant->payment_reference = $locked->payment_reference;

                return $locked->payment_reference;
            }

            $code = PaymentPrefix::from($locked->name);
            $ref = $this->uniqueReference($code);

            $locked->forceFill(['payment_reference' => $ref])->save();
            $tenant->payment_reference = $ref;

            return $ref;
        });
    }

    /** A "REIDEY-JAB-4821" not already taken by another company. */
    private function uniqueReference(string $code): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $ref = sprintf('%s-%s-%04d', self::PREFIX, $code, random_int(0, 9999));
            if (! Tenant::where('payment_reference', $ref)->exists()) {
                return $ref;
            }
        }

        // Extremely unlikely (would need thousands of same-prefix companies) —
        // widen the random space rather than loop forever.
        return sprintf('%s-%s-%06d', self::PREFIX, $code, random_int(0, 999999));
    }
}
