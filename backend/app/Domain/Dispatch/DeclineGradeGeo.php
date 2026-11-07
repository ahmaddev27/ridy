<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;

/**
 * Decides whether an inline-geocoded trip is trustworthy enough to DECLINE on its
 * road distance (the `min_price_per_km` Early-decline rule, docs/25). A decline is
 * irreversible, so this is deliberately stricter than the "~" estimate shown on a
 * push: every doubt returns a skip code and the offer is simply kept.
 *
 * Pure: no network, no DB writes. Inputs are the offer (after
 * {@see TripGeocoder::enrichForDecline()}) and the two geocoded endpoints.
 */
final class DeclineGradeGeo
{
    private const MIN_DISTANCE_M = 1000;

    private const MAX_DISTANCE_M = 150000;

    private const MIN_RATIO = 0.9;

    private const MAX_RATIO = 3.5;

    /**
     * @param  array{pickup: ?array<string, mixed>, dropoff: ?array<string, mixed>}|null  $endpoints
     * @return array{ok: bool, distance_m: ?int, skip: ?string}
     */
    public static function assess(DispatchOffer $offer, ?array $endpoints): array
    {
        $skip = self::skipReason($offer, $endpoints);

        return $skip === null
            ? ['ok' => true, 'distance_m' => (int) $offer->distance_m, 'skip' => null]
            : ['ok' => false, 'distance_m' => null, 'skip' => $skip];
    }

    /** @param  array{pickup: ?array<string, mixed>, dropoff: ?array<string, mixed>}|null  $endpoints */
    private static function skipReason(DispatchOffer $offer, ?array $endpoints): ?string
    {
        $pickup = $endpoints['pickup'] ?? null;
        $dropoff = $endpoints['dropoff'] ?? null;
        if ($pickup === null || $dropoff === null) {
            return 'unresolved';
        }

        $skip = self::endpointSkip($offer->pickup_address, $pickup, 'pickup')
            ?? self::endpointSkip($offer->dropoff_address, $dropoff, 'dropoff');
        if ($skip !== null) {
            return $skip;
        }

        if ($offer->geo_source === 'uber') {
            return 'uber_source';
        }
        if ($offer->geo_confidence !== 'exact' || $offer->distance_m === null) {
            return $offer->geo_confidence === 'estimated' ? 'estimated_route' : 'no_route';
        }

        return self::plausibilitySkip((int) $offer->distance_m, $pickup, $dropoff);
    }

    /** @param  array<string, mixed>  $geo */
    private static function endpointSkip(?string $raw, array $geo, string $end): ?string
    {
        if (($geo['confidence'] ?? null) !== 'exact') {
            return "{$end}_not_exact";
        }

        $address = AddressNormalizer::clean($raw);
        $parsed = AddressNormalizer::parse($address);
        $number = self::houseNumber($parsed['street'] ?? null);
        if ($number === null) {
            return "{$end}_no_house_number";
        }

        $city = CityMatcher::trustedCity($address);
        if ($city === null) {
            return "{$end}_no_plz";
        }

        return self::labelMatches((string) ($geo['address'] ?? ''), (string) $parsed['plz'], $number, $city)
            ? null
            : "{$end}_label_mismatch";
    }

    /** First number token of a street line ("Hauptstr. 66F" -> "66f"), or null. */
    private static function houseNumber(?string $street): ?string
    {
        if ($street === null || preg_match('/(?<!\d)(\d{1,4})\s?([a-zA-Z])?(?![\d\p{L}])/u', $street, $m) !== 1) {
            return null;
        }

        return mb_strtolower($m[1].($m[2] ?? ''));
    }

    /** The geocoded "Street 12, 44787 Bochum" label must agree on PLZ, number and city. */
    private static function labelMatches(string $label, string $plz, string $number, string $city): bool
    {
        if (preg_match('/^(.*),\s*(\d{5})\s+(.+)$/u', $label, $m) !== 1 || $m[2] !== $plz) {
            return false;
        }
        if (self::houseNumber($m[1]) !== $number) {
            return false;
        }

        $labelCity = CityMatcher::key($m[3]);
        $plzCity = CityMatcher::key($city);

        return $labelCity !== '' && (str_contains($labelCity, $plzCity) || str_contains($plzCity, $labelCity));
    }

    /**
     * @param  array<string, mixed>  $pickup
     * @param  array<string, mixed>  $dropoff
     */
    private static function plausibilitySkip(int $distanceM, array $pickup, array $dropoff): ?string
    {
        if ($distanceM < self::MIN_DISTANCE_M || $distanceM > self::MAX_DISTANCE_M) {
            return 'distance_out_of_range';
        }

        $crow = self::haversineM($pickup, $dropoff);
        if ($crow < 50) {
            return 'same_point';
        }
        $ratio = $distanceM / $crow;

        return $ratio < self::MIN_RATIO || $ratio > self::MAX_RATIO ? 'implausible_ratio' : null;
    }

    /**
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private static function haversineM(array $a, array $b): float
    {
        $lat1 = deg2rad((float) $a['lat']);
        $lat2 = deg2rad((float) $b['lat']);
        $dLat = $lat2 - $lat1;
        $dLng = deg2rad((float) $b['lng'] - (float) $a['lng']);
        $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;

        return 6371000 * 2 * asin(min(1.0, sqrt($h)));
    }
}
