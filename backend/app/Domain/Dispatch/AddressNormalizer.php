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
     * Arabic-Indic + Persian digits → ASCII, plus the Arabic decimal (٫) and
     * thousands (٬) separators → their Latin counterparts. Without the separators
     * a fare like "١٧٫٢٩" latinizes to "17٫29" — the ٫ is neither "." nor "," so
     * parseFare strips it and reads 1729, and the value renders wrong.
     */
    private const EASTERN_DIGITS = [
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٫' => ',', // Arabic decimal separator → German-style decimal comma
        '٬' => '.', // Arabic thousands separator → dot
    ];

    /** Convert eastern (Arabic/Persian) digits and separators to Latin. Uber
     *  localises numbers to the driver's app language; we always store/parse
     *  them as Latin. */
    public static function latinizeDigits(?string $value): ?string
    {
        return $value === null ? null : strtr($value, self::EASTERN_DIGITS);
    }

    /** True when the string still contains a non-Latin letter (an Arabic, Cyrillic,
     *  etc. street/city name that only a re-geocode can render in German). */
    public static function hasNonLatinLetters(?string $value): bool
    {
        return $value !== null && preg_match(self::NON_LATIN, $value) === 1;
    }

    /**
     * Return the address with any non-Latin (localised country) segment removed,
     * digits Latinized, and whitespace tidied. Splits on both the Latin (,) and
     * Arabic (،) comma. Idempotent, safe on write and read. Falls back to the
     * digit-Latinized original if stripping empties it.
     */
    public static function clean(?string $address): ?string
    {
        if ($address === null) {
            return null;
        }

        $original = trim((string) self::latinizeDigits($address));
        if ($original === '') {
            return $original;
        }

        $kept = array_filter(
            array_map('trim', preg_split('/[,،]/u', $original) ?: [$original]),
            static fn (string $segment): bool => $segment !== ''
                && preg_match(self::NON_LATIN, $segment) !== 1,
        );

        $cleaned = trim(implode(', ', $kept));

        // Never return an empty string just because every segment was non-Latin.
        return $cleaned !== '' ? $cleaned : $original;
    }
}
