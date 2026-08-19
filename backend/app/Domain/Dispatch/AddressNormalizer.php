<?php

namespace App\Domain\Dispatch;

/**
 * Normalises a dispatch address to a single, geocoder-friendly Latin form.
 *
 * Uber localises the address to the driver's app language, so the same street
 * can arrive with its country segment written in Arabic ("ألمانيا"), Cyrillic,
 * or another script. That mixed-script tail is noise for a single-country (DE)
 * fleet: it clutters the dashboard and hurts Nominatim's hit rate. We drop any
 * comma-separated segment that contains non-Latin letters, leaving the German
 * street/city intact.
 */
class AddressNormalizer
{
    /**
     * Matches a single character that is a letter but NOT in the Latin script —
     * i.e. a localized country name in Arabic, Cyrillic, Korean, Thai, CJK, etc.
     * Latin letters (including German umlauts ä/ö/ü/ß) are kept. Using the
     * Unicode property is future-proof: any non-Latin script is covered without
     * enumerating code-point ranges.
     */
    private const NON_LATIN = '/(?=\p{L})\P{Latin}/u';

    /**
     * Return the address with any non-Latin (localised country) segment removed
     * and whitespace tidied. Idempotent, so it is safe to apply on both write
     * and read. Falls back to the trimmed original if stripping empties it.
     */
    public static function clean(?string $address): ?string
    {
        if ($address === null) {
            return null;
        }

        $original = trim($address);
        if ($original === '') {
            return $original;
        }

        $kept = array_filter(
            array_map('trim', explode(',', $original)),
            static fn (string $segment): bool => $segment !== ''
                && preg_match(self::NON_LATIN, $segment) !== 1,
        );

        $cleaned = trim(implode(', ', $kept));

        // Never return an empty string just because every segment was non-Latin.
        return $cleaned !== '' ? $cleaned : $original;
    }
}
