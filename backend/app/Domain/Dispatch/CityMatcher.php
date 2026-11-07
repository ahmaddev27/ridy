<?php

namespace App\Domain\Dispatch;

use App\Domain\Geo\PostalCodes;

/**
 * Pure, network-free city logic for the Early-decline `reject_cities` rule.
 *
 * The ONLY trusted source of a city is the authoritative PLZ table
 * ({@see PostalCodes::city()}); free text in the address is never a source, only a
 * veto. A wrong decline is irreversible, so on any doubt {@see trustedCity()}
 * returns null and the offer simply goes through the normal push.
 */
final class CityMatcher
{
    /** Comparison key: lowercase, ä/ö/ü/ß → ae/oe/ue/ss, other diacritics and punctuation dropped. */
    public static function key(string $city): string
    {
        $city = mb_strtolower(trim($city));
        $city = strtr($city, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
        if (class_exists(\Normalizer::class)) {
            $city = (string) \Normalizer::normalize($city, \Normalizer::FORM_D);
        }
        $city = (string) preg_replace('/\p{Mn}+/u', '', $city);
        $city = (string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', $city);

        return trim((string) preg_replace('/\s+/', ' ', $city));
    }

    /**
     * The authoritative city of an address, or null when it cannot be trusted:
     * not exactly one distinct 5-digit PLZ, a PLZ missing from the table, or a
     * free-text town that clearly contradicts the PLZ's city.
     */
    public static function trustedCity(?string $rawAddress): ?string
    {
        $address = AddressNormalizer::clean($rawAddress);
        if ($address === null || $address === '') {
            return null;
        }

        preg_match_all('/(?<!\d)\d{5}(?!\d)/', $address, $matches);
        $plzs = array_values(array_unique($matches[0]));
        if (count($plzs) !== 1) {
            return null;
        }

        $plz = PostalCodes::normalize($plzs[0]);
        $city = $plz !== null ? PostalCodes::city($plz) : null;
        if ($city === null || trim($city) === '') {
            return null;
        }

        return self::contradictedByText($city, AddressNormalizer::parse($address)['city'] ?? null) ? null : $city;
    }

    /** Veto only: the text town and the PLZ city share no containment either way. */
    private static function contradictedByText(string $plzCity, ?string $textCity): bool
    {
        $text = $textCity === null ? '' : self::key($textCity);
        if ($text === '') {
            return false;
        }

        $plz = self::key($plzCity);

        return ! (str_contains($text, $plz) || str_contains($plz, $text));
    }
}
