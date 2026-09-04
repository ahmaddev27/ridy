<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use App\Domain\Geo\StationResolver;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Turns an offer's pickup/dropoff addresses into map coordinates + a road route,
 * using Nominatim for geocoding + OSRM for routing. The base URLs are
 * configurable (services.geo.*) so a self-hosted, rate-limit-free instance can
 * replace the free public services at scale — see docs/self-hosted-geo.md.
 * Results are cached on the offer (and addresses in a shared geocode_cache) so
 * the work runs once, lazily, on first detail view.
 */
class TripGeocoder
{
    public function __construct(private readonly StationResolver $stations) {}

    private const UA = 'Reidey/1.0 (fleet dispatch; contact: ops@reidey.de)';

    /** Per-call HTTP timeout (seconds); tightened for the bounded pre-notify run. */
    private int $httpTimeout = 6;

    /** Wall-clock deadline for a bounded run (microtime), or null when unbounded. */
    private ?float $deadline = null;

    /**
     * Nominatim + OSRM are our OWN containers on the internal Docker network.
     * Empty the proxy on these calls so they are NOT sent through the residential
     * proxy the app otherwise uses (which returns 429 for internal addresses).
     * Uber and other outbound calls keep their proxy — this only affects geo.
     */
    private const NO_PROXY = ['proxy' => ''];

    /** Nominatim /search endpoint (self-hosted or public), from config. */
    private function nominatimUrl(): string
    {
        return rtrim((string) config('services.geo.nominatim_url'), '/').'/search';
    }

    /** OSRM driving route endpoint (self-hosted or public), from config. */
    private function osrmUrl(): string
    {
        return rtrim((string) config('services.geo.osrm_url'), '/').'/route/v1/driving';
    }

    /**
     * Give up (mark synced) only after this many failed attempts. The backfill
     * runs every 5 minutes, so ~20 attempts span well over an hour of retries —
     * enough to ride out the free services' rate-limit windows before conceding.
     */
    private const MAX_ATTEMPTS = 20;

    /**
     * Geocode + route an offer once it succeeds, caching on the row. Safe to call
     * repeatedly: a transient failure (rate-limited free services) leaves
     * geo_synced_at null so a later call — or the backfill command — retries,
     * only giving up after {@see MAX_ATTEMPTS}.
     */
    /**
     * A bounded, synchronous enrich meant to run just BEFORE the offer push, so the
     * notification can already carry the distance + €-per-km. The fleet works a fixed
     * area, so its recurring streets are cache-warm and resolve instantly (DB only);
     * a cold address that would eat the ~5-second accept window trips the deadline and
     * is left to the async GeocodeOffer job to fill in a moment later. Never throws.
     */
    public function enrichForNotify(DispatchOffer $offer): DispatchOffer
    {
        $this->httpTimeout = 2;
        $this->deadline = microtime(true) + 2.5;
        try {
            return $this->enrich($offer);
        } finally {
            $this->httpTimeout = 6;
            $this->deadline = null;
        }
    }

    /** True once a bounded run has spent its time budget — stop making network calls. */
    private function pastDeadline(): bool
    {
        return $this->deadline !== null && microtime(true) >= $this->deadline;
    }

    public function enrich(DispatchOffer $offer): DispatchOffer
    {
        if ($offer->geo_synced_at !== null) {
            return $offer; // already done
        }

        // Bias ambiguous (postcode-less) addresses to where the trip actually is:
        // the driver's last known position for the pickup, then the resolved
        // pickup for the dropoff (a dispatch trip's ends are close together).
        $driver = $offer->driver_id !== null
            ? Driver::withoutGlobalScopes()->find($offer->driver_id)
            : null;
        $dLat = $driver?->latitude !== null ? (float) $driver->latitude : null;
        $dLng = $driver?->longitude !== null ? (float) $driver->longitude : null;

        // The pickup/dropoff shown to drivers stay EXACTLY as the supplier sent
        // them — we never rewrite the display address. Geocoding runs on enhanced
        // *copies* below, so a bare-station or street-less endpoint still resolves
        // to a precise point without changing what is displayed.
        $pickupQuery = (string) $offer->pickup_address;
        $dropoffQuery = (string) $offer->dropoff_address;

        // A bare "Hauptbahnhof"/"Bahnhof" endpoint carries no city of its own, so
        // borrow the counterpart's ("Hauptbahnhof" → "Hauptbahnhof, Düsseldorf")
        // for the geocode. Without this the word alone resolves to whatever station
        // is nearest the driver's town — a Solingen street for a Düsseldorf trip.
        [$pickupQuery, $dropoffQuery] = $this->fillBareStationCity($pickupQuery, $dropoffQuery);

        // A street-only end ("Königsberger Straße 66F" — no town, no postcode) can't
        // be placed on its own, so borrow the counterpart's town for the geocode
        // ("… 66F, Gevelsberg"). A dispatch trip's ends are in the same area, so the
        // other end's town is a safe bias. Query-only — the displayed address never
        // changes, so a borrowed town can never appear as a wrong city on the offer.
        [$pickupQuery, $dropoffQuery] = $this->borrowCounterpartCity($pickupQuery, $dropoffQuery);

        // Upgrade a street-less "PLZ City" (station pickup) to the station's real
        // street address from the local table for a precise geocode, and record the
        // resolved station's name for display alongside the raw address.
        $pickupStation = $this->stations->resolve($pickupQuery, $dLat, $dLng);
        if ($pickupStation !== null) {
            $pickupQuery = $pickupStation['formatted_address'];
            $offer->pickup_station_name = $pickupStation['station_name'];
        }
        $dropoffStation = $this->stations->resolve($dropoffQuery, $dLat, $dLng);
        if ($dropoffStation !== null) {
            $dropoffQuery = $dropoffStation['formatted_address'];
            $offer->dropoff_station_name = $dropoffStation['station_name'];
        }

        // Resolve the endpoint that has a postcode first, then bias the ambiguous
        // (postcode-less) one to it — a dispatch trip's ends are close together, so
        // the resolved end is a far better bias than the driver's position, which
        // may be a town away from where the trip actually is.
        if ($this->hasPostcode($dropoffQuery) && ! $this->hasPostcode($pickupQuery)) {
            $dropoff = $this->geocode($dropoffQuery, $dLat, $dLng);
            $pickup = $this->geocode($pickupQuery, $dropoff['lat'] ?? $dLat, $dropoff['lng'] ?? $dLng);
        } else {
            $pickup = $this->geocode($pickupQuery, $dLat, $dLng);
            $dropoff = $this->geocode($dropoffQuery, $pickup['lat'] ?? $dLat, $pickup['lng'] ?? $dLng);
        }

        $offer->pickup_lat = $pickup['lat'] ?? null;
        $offer->pickup_lng = $pickup['lng'] ?? null;
        $offer->dropoff_lat = $dropoff['lat'] ?? null;
        $offer->dropoff_lng = $dropoff['lng'] ?? null;

        // Fill ONLY a missing postcode from the geocoded result, and only when the
        // geocoded town matches the raw one — the city is never changed, so a wrong
        // geocode can't corrupt the address (it just stays raw).
        $offer->pickup_display = $this->completePostcode($offer->pickup_address, $pickup);
        $offer->dropoff_display = $this->completePostcode($offer->dropoff_address, $dropoff);

        if ($pickup && $dropoff) {
            $pConf = $pickup['confidence'] ?? null;
            $dConf = $dropoff['confidence'] ?? null;

            // Only trust a distance when BOTH ends resolved to a precise house number
            // ('exact'). An incomplete address — a pickup with no house number lands on
            // an arbitrary point of the street — produced garbage distances / €-per-km
            // (a "Hoheleye" pickup geocoded to 877 m one run and 65 m another for the
            // same trip). Per product decision we do NOT guess: leave the distance blank
            // until a RELIABLE source fills it — the driver accepts / finishes the trip
            // (Uber waypoints, via OfferLifecycle → applyFromWaypoints) or a later exact
            // geocode. €-per-km derives from distance_m, so it stays hidden until then.
            if ($pConf === 'exact' && $dConf === 'exact') {
                $route = $this->route($pickup, $dropoff);
                $offer->distance_m = $route['distance_m'] ?? null;
                $offer->route_geometry = $route['geometry'] ?? null;
                $offer->geo_confidence = $this->combinedConfidence($pConf, $dConf, $route);
            } else {
                $offer->distance_m = null;
                $offer->route_geometry = null;
                // Keep the address-level confidence (street/postal/…) — we resolved
                // the points, we just don't trust a distance between them.
                $offer->geo_confidence = $this->worstConfidence($pConf, $dConf);
            }
            $offer->geo_synced_at = CarbonImmutable::now(); // done — don't re-attempt this address
        } else {
            // Couldn't resolve both ends (transient rate-limit or unknown address).
            // Count the attempt and only give up after a few tries.
            $offer->geo_attempts = (int) $offer->geo_attempts + 1;
            if ($offer->geo_attempts >= self::MAX_ATTEMPTS) {
                $offer->geo_synced_at = CarbonImmutable::now();
            }
        }

        $offer->save();

        return $offer;
    }

    /** True when the address carries a 5-digit German postcode. */
    private function hasPostcode(?string $address): bool
    {
        return $address !== null && preg_match('/\b\d{5}\b/', $address) === 1;
    }

    /**
     * The supplier address with ONLY a missing postcode filled in from the
     * geocoded result — and only when the geocoded town matches the raw one, so
     * the city name is never altered. Returns the raw (tidied) address unchanged
     * when it already has a postcode, the geocode gave none, or the towns differ
     * (a possibly-wrong geocode must never rewrite the address).
     *
     * @param  array{address?: ?string}|null  $geo
     */
    private function completePostcode(?string $raw, ?array $geo): ?string
    {
        $raw = AddressFormatter::tidy($raw);
        if ($raw === null || $raw === '' || $this->hasPostcode($raw)) {
            return $raw; // nothing to add, or already complete
        }

        // The geocoded label's postcode + its authoritative town.
        if (! is_string($geo['address'] ?? null) || preg_match('/\b(\d{5})\b/', $geo['address'], $m) !== 1) {
            return $raw;
        }
        $plz = $m[1];
        $geoCity = PostalCodes::city($plz);
        if ($geoCity === null) {
            return $raw;
        }

        // Same town only: the raw's last segment (its town/district) must share a
        // name with the geocoded town — "Wuppertal-Elberfeld" matches "Wuppertal".
        $segments = array_map('trim', explode(',', $raw));
        $tail = (string) end($segments);
        $rawNorm = $this->normCity($tail);
        $geoNorm = $this->normCity($geoCity);
        if ($rawNorm === '' || $geoNorm === '' || (! str_contains($rawNorm, $geoNorm) && ! str_contains($geoNorm, $rawNorm))) {
            return $raw; // different town → leave raw, never risk a wrong postcode
        }

        // Insert the postcode before the town, keeping the raw town name as-is.
        $segments[count($segments) - 1] = $plz.' '.$tail;

        return implode(', ', $segments);
    }

    /** Lowercased letters-only town key for a tolerant same-town comparison. */
    private function normCity(string $value): string
    {
        return (string) preg_replace('/[^a-zà-ÿ]/u', '', mb_strtolower($value));
    }

    /**
     * A bare station word ("Hauptbahnhof", "Hbf", "Bahnhof", "Bf") with nothing
     * else — no street, no city, no postcode — normalised to its full German form
     * ("Hauptbahnhof" / "Bahnhof"), or null when the address is anything richer.
     */
    private function bareStationLabel(?string $address): ?string
    {
        $a = strtolower(trim((string) AddressNormalizer::clean($address)));
        $a = trim(str_replace('.', '', $a));

        return match ($a) {
            'hauptbahnhof', 'hbf' => 'Hauptbahnhof',
            'bahnhof', 'bf' => 'Bahnhof',
            default => null,
        };
    }

    /**
     * The town for an address, preferring the authoritative PLZ→city table (1:1 in
     * Germany) over the free-text parse. Null when the address names no town.
     */
    private function cityHint(?string $address): ?string
    {
        $parsed = AddressNormalizer::parse($address);

        return $parsed['plz'] !== null
            ? (PostalCodes::city($parsed['plz']) ?? $parsed['city'])
            : $parsed['city'];
    }

    /**
     * Give a bare "Hauptbahnhof"/"Bahnhof" endpoint the counterpart endpoint's
     * town, so a city-less station word geocodes to the right city's station
     * instead of the one nearest the driver. Only fires when the station end has
     * no town of its own and the other end does — never overrides a real city.
     * Operates on (and returns) geocoding query strings; the display address is
     * untouched.
     *
     * @return array{0: string, 1: string} the [pickup, dropoff] geocode queries
     */
    private function fillBareStationCity(string $pickup, string $dropoff): array
    {
        $pickupCity = $this->cityHint($pickup);
        $dropoffCity = $this->cityHint($dropoff);

        $pickupStation = $this->bareStationLabel($pickup);
        if ($pickupStation !== null && $pickupCity === null && $dropoffCity !== null) {
            $pickup = $pickupStation.', '.$dropoffCity;
        }

        $dropoffStation = $this->bareStationLabel($dropoff);
        if ($dropoffStation !== null && $dropoffCity === null && $pickupCity !== null) {
            $dropoff = $dropoffStation.', '.$pickupCity;
        }

        return [$pickup, $dropoff];
    }

    /**
     * Give a street-only end (a street/house number with no town or postcode of
     * its own) the counterpart end's town for the geocode, so it can be placed at
     * all. Only fires when this end names no town and the other end does — the
     * borrowed town is validated against the postal-code table, so a street word
     * is never mistaken for a city. Operates on (and returns) geocoding query
     * strings; the display address is untouched.
     *
     * @return array{0: string, 1: string} the [pickup, dropoff] geocode queries
     */
    private function borrowCounterpartCity(string $pickup, string $dropoff): array
    {
        $pickupCity = $this->townOf($pickup);
        $dropoffCity = $this->townOf($dropoff);

        if ($pickupCity === null && $dropoffCity !== null && $this->isStreetOnly($pickup)) {
            $pickup .= ', '.$dropoffCity;
        }
        if ($dropoffCity === null && $pickupCity !== null && $this->isStreetOnly($dropoff)) {
            $dropoff .= ', '.$pickupCity;
        }

        return [$pickup, $dropoff];
    }

    /**
     * The town an address names, or null. Prefers the authoritative PLZ→city
     * parse; when there is no postcode, accepts a trailing free-text town ("FIZ …
     * Gevelsberg" → "Gevelsberg") ONLY when it is a known German town, so a street
     * name is never taken for a city.
     */
    private function townOf(?string $address): ?string
    {
        $hint = $this->cityHint($address);
        if ($hint !== null) {
            return $hint;
        }

        $tidy = AddressFormatter::tidy($address); // drops the country tail
        if ($tidy === null || $tidy === '') {
            return null;
        }

        // Last comma segment, or the last word when there is no comma.
        $segments = array_map('trim', explode(',', $tidy));
        $tail = (string) end($segments);
        $candidate = str_contains($tidy, ',') ? $tail : trim((string) mb_substr(strrchr(' '.$tail, ' '), 1));
        $candidate = trim($candidate);

        // A house number ("66F") disqualifies it as a town; then require a real match.
        if ($candidate === '' || preg_match('/\d/', $candidate) === 1) {
            return null;
        }

        return PostalCodes::hasCity($candidate) ? $candidate : null;
    }

    /** An address that is a street/place but names no town or postcode of its own. */
    private function isStreetOnly(string $query): bool
    {
        return ! $this->hasPostcode($query)
            && $this->bareStationLabel($query) === null // bare stations handled separately
            && preg_match('/\p{L}/u', $query) === 1;
    }

    /**
     * Address → {lat,lng}, cached in geocode_cache (dedupes across offers).
     *
     * When the address has no German postcode it is ambiguous — the same street
     * name exists in dozens of towns, so Nominatim can resolve it to one 500 km
     * away and blow up the distance/€-per-km. If a bias point is supplied (the
     * driver's live position, or the already-resolved pickup) the lookup is
     * restricted to a box around it so the result stays in the trip's region.
     */
    private function geocode(?string $address, ?float $biasLat = null, ?float $biasLng = null): ?array
    {
        // Strip any localised (non-Latin) country tail so Nominatim sees a clean
        // German address — this is what mixed-script offers were failing on.
        $address = (string) AddressNormalizer::clean($address);
        $address = trim($address);
        if ($address === '') {
            return null;
        }

        // A 5-digit postcode makes the address unambiguous; without one, bias to
        // the supplied region when we have it.
        $ambiguous = preg_match('/\b\d{5}\b/', $address) !== 1;
        $useBias = $ambiguous && $biasLat !== null && $biasLng !== null;

        // A biased ambiguous result depends on the region, so fold the (coarse)
        // region into the cache key; a postcode-qualified address stays globally
        // cached and shared across drivers.
        $cacheKey = $useBias
            ? $address.'|@'.round($biasLat, 1).','.round($biasLng, 1)
            : $address;

        $cached = DB::table('geocode_cache')->where('query', $cacheKey)->first();
        if ($cached !== null) {
            if ($cached->lat === null) {
                return null;
            }
            $result = ['lat' => (float) $cached->lat, 'lng' => (float) $cached->lng];
            if (! empty($cached->label)) {
                $result['address'] = $cached->label; // unify to German even from cache
            }
            if (! empty($cached->confidence)) {
                $result['confidence'] = $cached->confidence;
            }

            return $result;
        }

        // Resolve through a precision cascade, stopping at the first tier that
        // returns a point and recording its confidence. Structured Nominatim
        // params (street/postalcode/city) are far more robust to Uber's garbled
        // free-text than a single `q`. A transient failure (network / rate-limit)
        // aborts WITHOUT caching so a later call retries instead of caching a miss.
        $parsed = AddressNormalizer::parse($address);
        $plz = $parsed['plz'];
        // Prefer the authoritative PLZ→city (1:1 in Germany) over Uber's parse.
        $city = $plz !== null ? (PostalCodes::city($plz) ?? $parsed['city']) : $parsed['city'];
        $street = $parsed['street'];

        $base = [
            'format' => 'json',
            'limit' => 1,
            'countrycodes' => 'de', // fleet is German — bias + speed up resolution
            'accept-language' => 'de', // return the German address, not the driver's app locale
            'addressdetails' => 1, // structured fields for the short "street, PLZ city" label
        ];

        $coords = null;

        // Tier 1 — street + PLZ + city (structured). House number → exact, else street.
        if ($coords === null && $street !== null && $plz !== null && $city !== null) {
            $r = $this->queryNominatim($base + ['street' => $street, 'postalcode' => $plz, 'city' => $city]);
            if ($r['transient']) {
                return null;
            }
            if ($r['hit'] !== null) {
                $coords = $this->fromHit($r['hit'], preg_match('/\d/', $street) === 1 ? 'exact' : 'street');
            }
        }

        // Tier 1b — street + city, NO postcode (structured). A dispatch offer often
        // carries a bare "Street 18A" whose town we borrowed from the counterpart end
        // (borrowCounterpartCity), but with no PLZ Tier 1 is skipped and the address
        // used to fall straight through to free-text (Tier 4), which misses far more
        // often. A structured street+city lookup places these precisely.
        if ($coords === null && $street !== null && $city !== null) {
            $r = $this->queryNominatim($base + ['street' => $street, 'city' => $city]);
            if ($r['transient']) {
                return null;
            }
            if ($r['hit'] !== null) {
                $coords = $this->fromHit($r['hit'], preg_match('/\d/', $street) === 1 ? 'exact' : 'street');
            }
        }

        // Tier 2 — PLZ + city, no street. A street-less "PLZ City" is usually a
        // station pickup/dropoff, so try the town's Bahnhof first, then the town.
        if ($coords === null && $plz !== null && $city !== null) {
            $st = $this->queryNominatim($base + ['q' => 'Bahnhof, '.$plz.' '.$city]);
            if ($st['transient']) {
                return null;
            }
            // Accept the station ONLY when its own postcode matches the one asked
            // for. A free-text "Bahnhof, PLZ City" otherwise returns the town's
            // MAIN Hbf regardless of PLZ — a different-postcode station kilometres
            // away — so a suburb pickup would snap to the Hauptbahnhof and blow up
            // the distance. On a mismatch we fall through to the plain town lookup.
            if ($st['hit'] !== null && $this->isStation($st['hit']) && $this->hitPostcodeMatches($st['hit'], $plz)) {
                $coords = $this->fromHit($st['hit'], 'area');
                // Use the station's real name ("Solingen Hauptbahnhof") from the
                // hit rather than a generic "Bahnhof", so a street-less station
                // pickup shows the actual stop it resolved to.
                $name = trim(explode(',', (string) ($st['hit']['display_name'] ?? ''))[0]);
                $coords['address'] = AddressFormatter::format($name !== '' ? $name : 'Bahnhof', $plz, $city);
            } else {
                $r = $this->queryNominatim($base + ['postalcode' => $plz, 'city' => $city]);
                if ($r['transient']) {
                    return null;
                }
                if ($r['hit'] !== null) {
                    $coords = $this->fromHit($r['hit'], 'area');
                }
            }
        }

        // Tier 3 — PLZ centroid from the static table (network-free safety net).
        if ($coords === null && $plz !== null) {
            $coords = $this->plzCentroidFallback($address);
            if ($coords !== null) {
                $coords['confidence'] = 'postal';
            }
        }

        // Tier 4 — postcode-less free text, biased to the trip's region when we
        // have a bias point (otherwise the same street name resolves 500 km away).
        if ($coords === null && $plz === null) {
            $params = $base + ['q' => $address];
            if ($useBias) {
                // ~22 km half-box, bounded — a dispatch pickup→drop-off is local, so
                // keeping the ambiguous end near the bias point (the driver, then the
                // resolved pickup) stops the same street name from resolving to a
                // town 50 km away and inflating the distance (e.g. a 6-min trip that
                // came out as 52 km). A wide box was the cause of those bad routes.
                $d = 0.2;
                $params['viewbox'] = ($biasLng - $d).','.($biasLat - $d).','.($biasLng + $d).','.($biasLat + $d);
                $params['bounded'] = 1;
            }
            $r = $this->queryNominatim($params);
            if ($r['transient']) {
                return null;
            }
            if ($r['hit'] !== null) {
                $coords = $this->fromHit($r['hit'], 'approx');
            }
        }

        // Atomic upsert (INSERT ... ON DUPLICATE KEY UPDATE): two requests geocoding
        // the same address concurrently would race a check-then-insert and trip the
        // unique key (1062). upsert lets the loser update instead of erroring. A
        // definitive miss ($coords null) is cached too, so it isn't re-queried.
        DB::table('geocode_cache')->upsert(
            [['query' => $cacheKey, 'lat' => $coords['lat'] ?? null, 'lng' => $coords['lng'] ?? null, 'label' => $coords['address'] ?? null, 'confidence' => $coords['confidence'] ?? null, 'updated_at' => now(), 'created_at' => now()]],
            ['query'],
            ['lat', 'lng', 'label', 'confidence', 'updated_at'],
        );

        return $coords;
    }

    /**
     * Coordinate → a full German street address ("Street 12, 42117 Wuppertal"),
     * cached in geocode_cache keyed by the rounded point so a fixed pickup/dropoff
     * is reverse-geocoded once. Returns null on a transient failure (not cached)
     * so a later call can still resolve it.
     */
    public function reverse(float $lat, float $lng): ?string
    {
        if (abs($lat) < 0.0001 && abs($lng) < 0.0001) {
            return null;
        }

        $key = 'rev|'.round($lat, 5).','.round($lng, 5);
        $cached = DB::table('geocode_cache')->where('query', $key)->first();
        if ($cached !== null) {
            return $cached->label !== null && $cached->label !== '' ? $cached->label : null;
        }

        try {
            $res = Http::withOptions(self::NO_PROXY)
                ->withHeaders(['User-Agent' => self::UA])
                ->timeout(5)
                ->get(rtrim((string) config('services.geo.nominatim_url'), '/').'/reverse', [
                    'lat' => $lat,
                    'lon' => $lng,
                    'format' => 'json',
                    'accept-language' => 'de',
                    'addressdetails' => 1,
                    'zoom' => 18,
                ]);
        } catch (\Throwable $e) {
            return null; // transient — do NOT cache, retry next poll
        }

        if (! $res->ok()) {
            return null;
        }

        // tidy() strips a "…, Deutschland" tail the display_name fallback leaves on
        // POIs (airports, stations) so the map label stays clean "Name, PLZ City".
        $label = AddressFormatter::tidy($this->shortGermanLabel($res->json()));

        DB::table('geocode_cache')->upsert(
            [['query' => $key, 'lat' => $lat, 'lng' => $lng, 'label' => $label, 'confidence' => 'exact', 'updated_at' => now(), 'created_at' => now()]],
            ['query'],
            ['lat', 'lng', 'label', 'confidence', 'updated_at'],
        );

        return $label;
    }

    /**
     * The geocode_cache key for a reverse-geocoded point — the same rounding
     * {@see reverse()} uses, so cached labels line up. Null for the 0,0 "no fix"
     * point (never worth a lookup).
     */
    public function reverseCacheKey(float $lat, float $lng): ?string
    {
        if (abs($lat) < 0.0001 && abs($lng) < 0.0001) {
            return null;
        }

        return 'rev|'.round($lat, 5).','.round($lng, 5);
    }

    /**
     * Batch cache-only reverse lookup for the live map: one `whereIn` over
     * geocode_cache for many points, NEVER a network call. Returns a map of
     * cache-key → label for the warm hits only; cold points are simply absent
     * (the caller falls back to the nearest town and backfills out-of-band).
     *
     * @param  array<int, array{0: float, 1: float}>  $points  [lat, lng] pairs
     * @return array<string, string> key → label (non-empty hits only)
     */
    public function cachedReverseLabels(array $points): array
    {
        $keys = [];
        foreach ($points as $p) {
            $key = $this->reverseCacheKey((float) $p[0], (float) $p[1]);
            if ($key !== null) {
                $keys[$key] = true;
            }
        }
        if ($keys === []) {
            return [];
        }

        $labels = [];
        DB::table('geocode_cache')
            ->select(['query', 'label'])
            ->whereIn('query', array_keys($keys))
            ->get()
            ->each(function ($row) use (&$labels) {
                if ($row->label !== null && $row->label !== '') {
                    $labels[$row->query] = $row->label;
                }
            });

        return $labels;
    }

    /**
     * The trip's overall geo confidence: the weaker of the two endpoints (a
     * distance is only as trustworthy as its worse point). Downgraded to
     * `estimated` when the route has no road geometry — OSRM was unreachable, so
     * the distance is a straight-line haversine estimate.
     *
     * @param  array{geometry: mixed}  $route
     */
    private function combinedConfidence(?string $pickup, ?string $dropoff, array $route): string
    {
        return ($route['geometry'] ?? null) === null ? 'estimated' : $this->worstConfidence($pickup, $dropoff);
    }

    /** The lower (more cautious) of the two endpoints' geocode confidences. */
    private function worstConfidence(?string $pickup, ?string $dropoff): string
    {
        $rank = ['exact' => 5, 'street' => 4, 'area' => 3, 'postal' => 2, 'approx' => 1];
        $worst = min($rank[$pickup] ?? 1, $rank[$dropoff] ?? 1);

        return array_search($worst, $rank, true) ?: 'approx';
    }

    /**
     * One Nominatim call. Returns {transient, hit}: `transient` true on a
     * network/timeout/non-200 (caller must abort without caching so a retry can
     * still succeed); `hit` is the first result with coordinates, or null for a
     * definitive "not found".
     *
     * @param  array<string, mixed>  $params
     * @return array{transient: bool, hit: array<string, mixed>|null}
     */
    private function queryNominatim(array $params): array
    {
        // Out of the bounded pre-notify budget → treat as transient (abort without
        // caching) so the async job resolves it later instead of blocking the push.
        if ($this->pastDeadline()) {
            return ['transient' => true, 'hit' => null];
        }

        try {
            $res = Http::withOptions(self::NO_PROXY)
                ->withHeaders(['User-Agent' => self::UA])
                ->timeout($this->httpTimeout)
                ->get($this->nominatimUrl(), $params);
        } catch (\Throwable $e) {
            return ['transient' => true, 'hit' => null];
        }

        if (! $res->ok()) {
            return ['transient' => true, 'hit' => null];
        }

        $hit = $res->json()[0] ?? null;

        return ['transient' => false, 'hit' => ($hit && isset($hit['lat'], $hit['lon'])) ? $hit : null];
    }

    /**
     * A resolved coordinate from a Nominatim hit, tagged with its confidence and a
     * short German label.
     *
     * @param  array<string, mixed>  $hit
     * @return array{lat: float, lng: float, confidence: string, address?: string}
     */
    private function fromHit(array $hit, string $confidence): array
    {
        $result = ['lat' => (float) $hit['lat'], 'lng' => (float) $hit['lon'], 'confidence' => $confidence];
        $label = $this->shortGermanLabel($hit);
        if ($label !== null) {
            $result['address'] = $label;
        }

        return $result;
    }

    /**
     * Build a compact German address label from Nominatim's structured fields:
     * "Street 12, 44787 Bochum". Keeps only what a driver needs to recognise the
     * spot — street (+ house number) and the city with its postal code — instead
     * of the long "…, Nordrhein-Westfalen, Deutschland" display_name tail. Falls
     * back to whatever single part exists, then to display_name, then null.
     *
     * @param  array<string, mixed>|null  $hit
     */
    /**
     * True when a Nominatim hit is a railway station/stop — used to confirm a
     * street-less "PLZ City" address really resolved to the town's Bahnhof before
     * we label it as one.
     *
     * @param  array<string, mixed>|null  $hit
     */
    /**
     * True when a Nominatim hit's own postcode equals the one we searched for —
     * the guard that stops a "Bahnhof, PLZ City" free-text lookup from snapping to
     * a different-postcode main station. A hit without a postcode can't be
     * confirmed, so it is rejected (strict).
     *
     * @param  array<string, mixed>  $hit
     */
    private function hitPostcodeMatches(array $hit, string $plz): bool
    {
        $postcode = $hit['address']['postcode'] ?? null;

        return is_string($postcode) && $postcode === $plz;
    }

    private function isStation(?array $hit): bool
    {
        if ($hit === null) {
            return false;
        }
        $class = strtolower((string) ($hit['class'] ?? ''));
        $type = strtolower((string) ($hit['type'] ?? ''));
        $name = strtolower((string) ($hit['display_name'] ?? ''));

        return ($class === 'railway' && in_array($type, ['station', 'halt', 'stop'], true))
            || str_contains($name, 'bahnhof');
    }

    private function shortGermanLabel(?array $hit): ?string
    {
        $a = is_array($hit['address'] ?? null) ? $hit['address'] : [];

        // Street line: road/pedestrian/footway (+ house number), else a named place
        // (airport/station/amenity) so a POI reads "Flughafen Düsseldorf" instead
        // of collapsing to a bare "PLZ City" or the raw country-tailed display_name.
        $street = $a['road'] ?? $a['pedestrian'] ?? $a['footway'] ?? $a['neighbourhood'] ?? null;
        if ($street !== null && ! empty($a['house_number'])) {
            $street = "{$street} {$a['house_number']}";
        }
        if ($street === null) {
            $name = $hit['name'] ?? $a['aeroway'] ?? $a['amenity'] ?? $a['building'] ?? $a['railway'] ?? null;
            $street = is_string($name) && trim($name) !== '' ? trim($name) : null;
        }

        // City line: the settlement, prefixed with its postal code when present.
        $city = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['suburb'] ?? null;
        if ($city !== null && ! empty($a['postcode'])) {
            $city = "{$a['postcode']} {$city}";
        }

        $label = trim(implode(', ', array_filter([$street, $city])));
        if ($label !== '') {
            return $label;
        }

        $display = $hit['display_name'] ?? null;

        return is_string($display) && $display !== '' ? $display : null;
    }

    /**
     * The town centroid for an address's PLZ, or null when it has no valid PLZ or
     * the code is unknown. Labelled with the authoritative "PLZ City".
     *
     * @return array{lat: float, lng: float, address?: string}|null
     */
    private function plzCentroidFallback(string $address): ?array
    {
        if (preg_match('/\b(\d{5})\b/', $address, $m) !== 1) {
            return null;
        }
        $centroid = PostalCodes::centroid($m[1]);
        if ($centroid === null) {
            return null;
        }

        $result = ['lat' => $centroid['lat'], 'lng' => $centroid['lng']];
        $city = PostalCodes::city($m[1]);
        if ($city !== null) {
            $result['address'] = "{$m[1]} {$city}";
        }

        return $result;
    }

    /**
     * Road distance + route geometry via OSRM; falls back to a straight-line
     * haversine distance (no geometry) when OSRM is unreachable.
     *
     * @return array{distance_m: int|null, geometry: array|null}
     */
    private function route(array $from, array $to): array
    {
        // Past the bounded budget → skip OSRM, use the instant haversine estimate so
        // the push still carries a distance (the async job upgrades it to a road route).
        if ($this->pastDeadline()) {
            return ['distance_m' => $this->haversine($from, $to), 'geometry' => null];
        }

        try {
            $path = "{$from['lng']},{$from['lat']};{$to['lng']},{$to['lat']}";
            $res = Http::withOptions(self::NO_PROXY)->timeout($this->httpTimeout)->get($this->osrmUrl().'/'.$path, [
                'overview' => 'full',
                'geometries' => 'geojson',
            ]);
            $route = $res->ok() ? ($res->json('routes.0') ?? null) : null;
            if ($route) {
                return [
                    'distance_m' => (int) round($route['distance']),
                    'geometry' => $route['geometry'] ?? null, // GeoJSON LineString [lng,lat]
                ];
            }
        } catch (\Throwable $e) {
            // fall through to haversine
        }

        return ['distance_m' => $this->haversine($from, $to), 'geometry' => null];
    }

    /**
     * Resolve an offer's trip from Uber's live-map waypoints — the authoritative
     * pickup/drop-off (and any extra stops) captured once a driver accepts and
     * goes en-route. Fixes offers whose text-only address couldn't be geocoded,
     * and reveals multi-stop trips. Returns the number of drop-off stops when it
     * updated the offer (>= 2 = multi-stop), or null when it did nothing.
     *
     * Query-of-truth: the coordinates are Uber's, so reverse-geocoding them to a
     * label (formatted our way) carries no wrong-city risk. We only touch geo that
     * isn't already precise from Uber and whose own geocode was incomplete — never
     * overriding a good geocoded distance — but a change in the stop count always
     * refreshes, so a stop added mid-trip is picked up.
     *
     * @param  array<int, array<string, mixed>>  $waypoints  [{lat,lng,type}, ...]
     */
    public function applyFromWaypoints(DispatchOffer $offer, array $waypoints): ?int
    {
        $points = $this->cleanWaypoints($waypoints);
        if (count($points) < 2) {
            return null; // need at least a pickup + one drop-off
        }

        $stopsCount = count($points) - 1; // everything after the pickup is a drop-off
        // Uber's waypoint list SHRINKS as the driver progresses: EN_ROUTE it holds the
        // full itinerary [PICKUP, DROPOFF, …]; once ON_TRIP the pickup is dropped, so a
        // 2-stop trip goes [PICKUP,D1,D2] → [D1,D2] → [D2]. The full EN_ROUTE capture is
        // the source of truth, so only RE-resolve when the count GROWS — a shrink is just
        // the driver completing a leg and must not overwrite the offer's real stop count.
        $stopsGrew = $stopsCount > (int) ($offer->stops_count ?? 0);
        // Uber's live-map coordinates are authoritative, so adopt them for ANY accepted
        // offer not yet resolved from Uber — even one our geocoder already placed (a
        // text-only address can resolve to a plausible-but-wrong point). geo_source=uber
        // marks it done so this runs once; a larger itinerary still refreshes.
        $needs = $offer->geo_source !== 'uber';
        if (! $needs && ! $stopsGrew) {
            return null;
        }

        $pickup = $points[0];
        $dropoff = $points[count($points) - 1];

        $offer->pickup_lat = $pickup['lat'];
        $offer->pickup_lng = $pickup['lng'];
        $offer->dropoff_lat = $dropoff['lat'];
        $offer->dropoff_lng = $dropoff['lng'];

        $route = $this->routeThrough($points);
        if ($route['distance_m'] !== null) {
            $offer->distance_m = $route['distance_m'];
            $offer->route_geometry = $route['geometry'];
        }

        // Fill a missing/rough display address from the REAL point, our format.
        $offer->pickup_display = $this->labelForPoint($offer->pickup_address, $pickup) ?? $offer->pickup_display;
        $offer->dropoff_display = $this->labelForPoint($offer->dropoff_address, $dropoff) ?? $offer->dropoff_display;

        // Label every stop from its real coordinate so the detail view can list each
        // drop-off by address (a multi-stop trip's intermediate stops have no address
        // in Uber's offer payload — only coordinates on the live map). The endpoints
        // reuse the corrected pickup/drop-off display; intermediates reverse-geocode.
        // Each stop also carries the road distance from the previous stop (its leg).
        $offer->stops = $this->labelStops($points, $offer->pickup_display, $offer->dropoff_display, $route['legs']);
        $offer->stops_count = $stopsCount;
        $offer->geo_source = 'uber';
        $offer->geo_confidence = 'exact';
        $offer->geo_synced_at = CarbonImmutable::now();
        $offer->save();

        return $stopsCount;
    }

    /**
     * Normalise raw waypoints to valid German-box coordinates, dropping the
     * redacted 0,0 fixes Uber returns for un-engaged legs.
     *
     * @param  array<int, array<string, mixed>>  $waypoints
     * @return array<int, array{lat: float, lng: float, type: string|null}>
     */
    private function cleanWaypoints(array $waypoints): array
    {
        $out = [];
        foreach ($waypoints as $w) {
            if (! isset($w['lat'], $w['lng'])) {
                continue;
            }
            $lat = (float) $w['lat'];
            $lng = (float) $w['lng'];
            if (abs($lat) < 0.0001 && abs($lng) < 0.0001) {
                continue; // redacted point
            }
            $out[] = ['lat' => $lat, 'lng' => $lng, 'type' => isset($w['type']) ? (string) $w['type'] : null];
        }

        return $out;
    }

    /**
     * A display label for a point, ONLY when the supplier's own address was
     * incomplete (no postcode): reverse-geocode the real coordinate, formatted our
     * way. Returns null to keep the supplier's text when it's already complete.
     */
    private function labelForPoint(?string $rawAddress, array $point): ?string
    {
        $label = $this->reverse($point['lat'], $point['lng']);
        if ($label === null || $label === '') {
            return null; // reverse unavailable → keep whatever display we had
        }

        // Uber's coordinate is authoritative, so ALWAYS prefer its reverse-geocoded
        // address — unless the supplier's own text is at least as complete (e.g. it
        // carries a house number the reverse lacks), so an accept never downgrades a
        // good address. A street-less "42697 Solingen" always loses to the reverse.
        $raw = AddressFormatter::tidy($rawAddress);
        if ($raw !== null && $raw !== '' && $this->addressScore($raw) >= $this->addressScore($label)) {
            return null; // supplier text is as good or better — keep the current display
        }

        return $label;
    }

    /**
     * Attach a display address to each ordered stop. The first/last stops reuse the
     * already-corrected pickup/drop-off labels (endpoints the offer text describes);
     * intermediate stops — which Uber's offer never names — are reverse-geocoded from
     * their real coordinate. A stop whose reverse lookup is unavailable keeps a null
     * address rather than blocking the others.
     *
     * @param  array<int, array{lat: float, lng: float, type: string|null}>  $points
     * @param  array<int, int>  $legs  road distance (m) of each leg: leg i = point i → i+1
     * @return array<int, array{lat: float, lng: float, type: string|null, address: string|null, leg_m: int|null, cumulative_m: int}>
     */
    private function labelStops(array $points, ?string $pickupLabel, ?string $dropoffLabel, array $legs = []): array
    {
        $last = count($points) - 1;
        $cumulative = 0;

        $out = [];
        foreach ($points as $i => $p) {
            $address = match ($i) {
                0 => $pickupLabel,
                $last => $dropoffLabel,
                default => $this->reverse($p['lat'], $p['lng']),
            };

            // Leg INTO this stop (from the previous one); the pickup has none.
            $legM = $i === 0 ? null : ($legs[$i - 1] ?? null);
            $cumulative += $legM ?? 0;

            $out[] = $p + [
                'address' => $address !== '' ? $address : null,
                'leg_m' => $legM,
                'cumulative_m' => $cumulative,
            ];
        }

        return $out;
    }

    /** Rough completeness score of an address: +street, +house number, +postcode. */
    private function addressScore(string $address): int
    {
        $street = (string) (AddressNormalizer::parse($address)['street'] ?? '');
        $score = 0;
        if ($street !== '') {
            $score++;
        }
        if (preg_match('/\d/', $street) === 1) {
            $score++; // a house number in the street segment
        }
        if ($this->hasPostcode($address)) {
            $score++;
        }

        return $score;
    }

    /**
     * Road distance + geometry through an ordered list of points (multi-stop), via
     * one OSRM request. Also returns the per-leg distances (leg i = point i → i+1),
     * so each stop can show the road distance from the previous one. Falls back to
     * straight-line legs when OSRM is unreachable.
     *
     * @param  array<int, array{lat: float, lng: float}>  $points
     * @return array{distance_m: int|null, geometry: array|null, legs: array<int, int>}
     */
    private function routeThrough(array $points): array
    {
        if (count($points) < 2) {
            return ['distance_m' => null, 'geometry' => null, 'legs' => []];
        }

        try {
            $path = implode(';', array_map(fn ($p) => "{$p['lng']},{$p['lat']}", $points));
            $res = Http::withOptions(self::NO_PROXY)->timeout(8)->get($this->osrmUrl().'/'.$path, [
                'overview' => 'full',
                'geometries' => 'geojson',
            ]);
            $route = $res->ok() ? ($res->json('routes.0') ?? null) : null;
            if ($route) {
                // OSRM returns one leg per consecutive point pair, each with its own
                // road distance — the authoritative per-stop distance.
                $legs = array_map(fn ($leg) => (int) round($leg['distance'] ?? 0), $route['legs'] ?? []);

                return ['distance_m' => (int) round($route['distance']), 'geometry' => $route['geometry'] ?? null, 'legs' => $legs];
            }
        } catch (\Throwable $e) {
            // fall through to summed straight-line legs
        }

        $legs = [];
        for ($i = 1, $n = count($points); $i < $n; $i++) {
            $legs[] = $this->haversine($points[$i - 1], $points[$i]);
        }

        return ['distance_m' => array_sum($legs), 'geometry' => null, 'legs' => $legs];
    }

    /** Straight-line distance in metres. */
    private function haversine(array $a, array $b): int
    {
        $r = 6371000;
        $dLat = deg2rad($b['lat'] - $a['lat']);
        $dLng = deg2rad($b['lng'] - $a['lng']);
        $h = sin($dLat / 2) ** 2 + cos(deg2rad($a['lat'])) * cos(deg2rad($b['lat'])) * sin($dLng / 2) ** 2;

        return (int) round($r * 2 * asin(min(1, sqrt($h))));
    }
}
