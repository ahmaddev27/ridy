<?php

namespace App\Domain\Billing;

use Illuminate\Support\Str;

/**
 * The 3-letter company code used in payment references (e.g. "Dinari Transport"
 * → "DIN"). Transliterated to Latin + uppercased, padded to 3 with "X", and a
 * generic "CMP" when the name has no Latin letters at all. Shared by the per-code
 * {@see PaymentReferenceGenerator} and the per-company {@see CompanyReferenceGenerator}
 * so both derive the same prefix.
 */
class PaymentPrefix
{
    public static function from(?string $name): string
    {
        $ascii = Str::ascii((string) $name);
        $letters = strtoupper((string) preg_replace('/[^A-Za-z]/', '', $ascii));
        $prefix = substr($letters, 0, 3);

        if ($prefix === '') {
            return 'CMP'; // a name with no Latin letters (e.g. all-Arabic) → generic
        }

        return str_pad($prefix, 3, 'X'); // "A1 Co" → "ACO"; "Q" → "QXX"
    }
}
