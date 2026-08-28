<?php

namespace App\Domain\Geo;

use App\Domain\Dispatch\AddressFormatter;
use App\Domain\Dispatch\AddressNormalizer;
use App\Domain\Geo\Models\RailwayStation;
use Illuminate\Support\Collection;

/**
 * Turns a street-less "PLZ City" pickup — the usual station-pickup shape Uber
 * sends — into the station's real address, using the locally-imported
 * {@see RailwayStation} table. Purely local + indexed: no network, no geocoding.
 *
 * Deliberately conservative: it only acts when the address has NO street of its
 * own, and it never guesses between two stations in the same PLZ. When it can't
 * identify exactly one station with confidence it returns null and the caller
 * keeps the original address — we never invent one.
 */
class StationResolver
{
    /**
     * @return array{
     *   matched: bool, station_name: string, street: ?string, house_number: ?string,
     *   postal_code: ?string, city: ?string, formatted_address: string,
     *   latitude: ?float, longitude: ?float, source: string
     * }|null  null when the address already has a street, has no usable PLZ+city,
     *         or no single station can be identified with confidence.
     */
    public function resolve(?string $address, ?float $biasLat = null, ?float $biasLng = null): ?array
    {
        $parsed = AddressNormalizer::parse($address);

        $plz = $parsed['plz'];
        if ($plz === null) {
            return null;
        }

        // Authoritative PLZ→city (1:1 in Germany) beats Uber's parse.
        $city = PostalCodes::city($plz) ?? $parsed['city'];
        if ($city === null) {
            return null;
        }

        // Only step in for a street-less address — never override a real street.
        if ($this->hasOwnStreet($parsed['street'], $city)) {
            return null;
        }

        $stations = $this->candidates($plz, $city);
        if ($stations->isEmpty()) {
            return null;
        }

        $match = $stations->count() === 1
            ? $stations->first()
            : $this->disambiguate($stations, $biasLat, $biasLng);

        return $match !== null ? $this->toResult($match) : null;
    }

    /**
     * Candidate stations: exact (PLZ, city) first, then PLZ alone as a fallback
     * for a mismatched/renamed city — both indexed, so the hot path is a keyed
     * lookup, never a scan.
     *
     * @return Collection<int, RailwayStation>
     */
    private function candidates(string $plz, string $city): Collection
    {
        $exact = RailwayStation::query()
            ->where('postal_code', $plz)
            ->where('normalized_city', RailwayStation::normalizeCity($city))
            ->get();

        if ($exact->isNotEmpty()) {
            return $exact;
        }

        return RailwayStation::query()->where('postal_code', $plz)->get();
    }

    /**
     * More than one station in the PLZ: pick the nearest to the bias point (the
     * driver's live position) when we have one; otherwise it is genuinely
     * ambiguous and we refuse to guess.
     *
     * @param  Collection<int, RailwayStation>  $stations
     */
    private function disambiguate(Collection $stations, ?float $biasLat, ?float $biasLng): ?RailwayStation
    {
        if ($biasLat === null || $biasLng === null) {
            return null; // ambiguous — never choose arbitrarily
        }

        $located = $stations->filter(fn (RailwayStation $s) => $s->latitude !== null && $s->longitude !== null);
        if ($located->isEmpty()) {
            return null;
        }

        return $located
            ->sortBy(fn (RailwayStation $s) => $this->squaredDistance($biasLat, $biasLng, (float) $s->latitude, (float) $s->longitude))
            ->first();
    }

    /** Cheap comparison metric (no sqrt needed for nearest-selection). */
    private function squaredDistance(float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $dLat = $aLat - $bLat;
        $dLng = ($aLng - $bLng) * cos(deg2rad($aLat)); // longitude shrinks with latitude

        return $dLat * $dLat + $dLng * $dLng;
    }

    /**
     * True when the address carries a street of its own (so we must not replace
     * it): a house number is present, or the pre-PLZ segment is a real street
     * name distinct from the city — not just the town repeated.
     */
    private function hasOwnStreet(?string $street, string $city): bool
    {
        if ($street === null || trim($street) === '') {
            return false;
        }
        if (preg_match('/\d/', $street) === 1) {
            return true; // a house number ⇒ a real street
        }

        return RailwayStation::normalizeCity($street) !== RailwayStation::normalizeCity($city);
    }

    /** @return array<string, mixed> */
    private function toResult(RailwayStation $s): array
    {
        return [
            'matched' => true,
            'station_name' => $s->name,
            'street' => $s->street,
            'house_number' => $s->house_number,
            'postal_code' => $s->postal_code,
            'city' => $s->city,
            'formatted_address' => AddressFormatter::format($s->street_line, $s->postal_code, $s->city),
            'latitude' => $s->latitude,
            'longitude' => $s->longitude,
            'source' => $s->source,
        ];
    }
}
