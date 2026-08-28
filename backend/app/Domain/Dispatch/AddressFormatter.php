<?php

namespace App\Domain\Dispatch;

/**
 * Turns the two address strings we have for a trip endpoint — Uber's own
 * (unreliable) text and the geocoder's canonical German label — into a single
 * clean, consistently-ordered "Street Nr, PLZ City" display value.
 *
 * Uber's text is inconsistent: sometimes street-less ("42697 Solingen", a
 * station pickup), sometimes street-only ("Sandstrasse 10", no town), sometimes
 * complete. The self-hosted Nominatim resolves each into a full German label;
 * this formatter decides which of the two to show by *completeness*, so the
 * driver always sees the most informative, tidily-formatted address available —
 * the station's real name for a street-less pickup, the filled-in town for a
 * street-only one, and Uber's own text only when the geocoder had nothing better.
 *
 * Pure (no HTTP / DB) so it is fast and unit-testable; the authoritative
 * PLZ↔city correction stays in {@see TripGeocoder} which owns the lookup.
 */
class AddressFormatter
{
    /**
     * Choose and clean the address to display, given Uber's original and the
     * geocoder result (`['address' => label, 'confidence' => ...]`, or null).
     * Prefers the geocoder label whenever it is at least as complete as Uber's
     * text; otherwise keeps Uber's own (tidied) text.
     *
     * @param  array{address?: ?string, confidence?: ?string}|null  $geo
     */
    public static function canonical(?string $uber, ?array $geo): ?string
    {
        $uberTidy = self::tidy($uber);
        $label = self::tidy($geo['address'] ?? null);

        // Nothing from the geocoder → best we can show is Uber's own tidy text.
        if ($label === null) {
            return $uberTidy;
        }

        // A non-Latin (Arabic/Cyrillic) original is unreadable and never matches
        // Uber's German anyway — always defer to the geocoder's German label.
        if ($uberTidy === null || AddressNormalizer::hasNonLatinLetters((string) $uber)) {
            return $label;
        }

        // Both present: show whichever carries more of {street, house-no, PLZ,
        // city}. Ties go to the geocoder (canonical spelling, correct town).
        return self::completeness($label) >= self::completeness($uberTidy)
            ? $label
            : $uberTidy;
    }

    /**
     * Assemble a canonical label from discrete parts, dropping the empties and
     * de-duplicating: `format("Sandstraße 10", "42655", "Solingen")`
     * → "Sandstraße 10, 42655 Solingen".
     */
    public static function format(?string $street, ?string $plz, ?string $city): string
    {
        $street = self::squash($street);
        $plz = self::squash($plz);
        $city = self::squash($city);

        $tail = trim(implode(' ', array_filter([$plz, $city])));

        return trim(implode(', ', array_filter([$street, $tail !== '' ? $tail : null])));
    }

    /**
     * Strip the localised country tail, Latinize digits, collapse whitespace and
     * duplicate commas. Returns null for an empty result so callers can fall back.
     */
    public static function tidy(?string $address): ?string
    {
        if ($address === null) {
            return null;
        }

        // clean() removes non-Latin (localised country) segments + Latinizes digits.
        $a = (string) AddressNormalizer::clean($address);
        // Drop a "Deutschland/Germany" token ANYWHERE — Uber sometimes puts it
        // mid-string ("Solingen, Deutschland 42697"), not only as a trailing tail.
        $a = (string) preg_replace('/\s*,?\s*\b(Deutschland|Germany)\b\s*,?/iu', ' ', $a);
        // Collapse repeated/leading/trailing commas + spaces produced by the strips.
        $a = (string) preg_replace('/\s*,\s*,+/', ', ', $a);
        $a = trim((string) preg_replace('/^\s*,\s*|\s*,\s*$/', '', $a));
        $a = self::squash($a);

        return $a !== '' ? $a : null;
    }

    /**
     * A 0–5 score of how much of {street (2), house-no (1), PLZ (1), city (1)} an
     * address carries — the basis for choosing the more informative of two labels.
     */
    public static function completeness(?string $address): int
    {
        $a = self::squash($address);
        if ($a === '') {
            return 0;
        }

        // Split around the 5-digit PLZ: street precedes it, city follows.
        if (preg_match('/\b(\d{5})\b/', $a, $m, PREG_OFFSET_CAPTURE) === 1) {
            $at = (int) $m[1][1];
            $streetPart = trim(rtrim(trim(substr($a, 0, $at)), ','));
            $after = trim(explode(',', trim(substr($a, $at + 5)))[0]);
            $hasPlz = true;
            $hasCity = preg_match('/\p{L}/u', $after) === 1;
        } else {
            $streetPart = $a;
            $hasPlz = false;
            $hasCity = false;
        }

        $hasStreet = preg_match('/\p{L}/u', $streetPart) === 1;
        $hasNumber = preg_match('/\d/', $streetPart) === 1;

        return ($hasStreet ? 2 : 0) + ($hasNumber ? 1 : 0) + ($hasPlz ? 1 : 0) + ($hasCity ? 1 : 0);
    }

    /** Trim + collapse internal whitespace runs to single spaces. */
    private static function squash(?string $value): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', (string) $value));
    }
}
