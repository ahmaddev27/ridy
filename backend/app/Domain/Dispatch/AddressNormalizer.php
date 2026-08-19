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
    /** Matches a letter from a script we never want in a German address. */
    private const NON_LATIN = '/[\x{0600}-\x{06FF}\x{0750}-\x{077F}'  // Arabic
        .'\x{0400}-\x{04FF}'                                          // Cyrillic
        .'\x{0590}-\x{05FF}'                                          // Hebrew
        .'\x{4E00}-\x{9FFF}\x{3040}-\x{30FF}'                         // CJK / Kana
        .'\x{0370}-\x{03FF}]/u';                                      // Greek

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
