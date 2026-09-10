<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Geo\PostalCodes;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OfferTripTest extends TestCase
{
    use RefreshDatabase;

    public function test_offer_detail_geocodes_and_computes_price_per_km(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd1',
            'offer_uuid' => 'o1',
            'pickup_address' => 'Horather Straße 183, 42111 Wuppertal',
            'dropoff_address' => 'Posener Str. 36, 42283 Wuppertal',
            'fare_formatted' => '6,43 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'o1'],
        ]);

        // Fake the free geocoding + routing services.
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::sequence()
                ->push([['lat' => '51.25', 'lon' => '7.15']])
                ->push([['lat' => '51.27', 'lon' => '7.20']]),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [[
                    'distance' => 5200, // 5.2 km
                    'geometry' => ['type' => 'LineString', 'coordinates' => [[7.15, 51.25], [7.20, 51.27]]],
                ]],
            ]),
        ]);

        Sanctum::actingAs($user);

        // Opening an offer QUEUES the geocode (GeocodeOffer) instead of running two
        // Nominatim calls plus an OSRM route inside the GET; the detail renders from
        // what is stored, so the resolved trip shows on the next read.
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();

        $res = $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();
        $res->assertJsonPath('data.trip.distance_km', 5.2)
            ->assertJsonPath('data.trip.fare_amount', 6.43)
            ->assertJsonPath('data.trip.price_per_km', 1.24) // 6.43 / 5.2
            ->assertJsonPath('data.trip.pickup.lat', 51.25)
            // Both ends have a house number and OSRM returned a route → exact.
            ->assertJsonPath('data.trip.geo_confidence', 'exact');

        // Cached on the row — a second view does not re-hit the services.
        $fresh = $offer->fresh();
        $this->assertNotNull($fresh->geo_synced_at);
        // The display addresses are left EXACTLY as the supplier sent them —
        // geocoding never rewrites them (no city duplication / postcode splicing).
        $this->assertSame('Horather Straße 183, 42111 Wuppertal', $fresh->pickup_address);
        $this->assertSame('Posener Str. 36, 42283 Wuppertal', $fresh->dropoff_address);
    }

    public function test_street_level_drop_without_a_house_number_gets_an_approximate_distance(): void
    {
        // A drop-off with a known street + PLZ + city but NO house number resolves to
        // 'street' confidence. It used to leave the distance blank (no-guess); now the
        // point is on the RIGHT street in the RIGHT town, so we compute an APPROXIMATE
        // distance (flagged 'street', shown with "~" in the push) — only AREA/APPROX
        // ends stay withheld. The accept's Uber waypoints later upgrade it to exact.
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M2', 'email' => 'm2@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd2',
            'offer_uuid' => 'o2',
            'pickup_address' => 'Hammersteiner Allee 22, 42329 Wuppertal', // house number → exact
            'dropoff_address' => 'Lüntenbecker Weg, 42327 Wuppertal',       // NO house number → street
            'fare_formatted' => '4,57 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'o2'],
        ]);

        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::sequence()
                ->push([['lat' => '51.24', 'lon' => '7.10']])
                ->push([['lat' => '51.23', 'lon' => '7.12']]),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [[
                    'distance' => 3400, // 3.4 km
                    'geometry' => ['type' => 'LineString', 'coordinates' => [[7.10, 51.24], [7.12, 51.23]]],
                ]],
            ]),
        ]);

        Sanctum::actingAs($user);

        // Opening an offer QUEUES the geocode (GeocodeOffer) instead of running two
        // Nominatim calls plus an OSRM route inside the GET; the detail renders from
        // what is stored, so the resolved trip shows on the next read.
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk()
            ->assertJsonPath('data.trip.distance_km', 3.4)
            ->assertJsonPath('data.trip.price_per_km', 1.34) // 4.57 / 3.4
            ->assertJsonPath('data.trip.geo_confidence', 'street');
    }

    public function test_airport_pickup_resolves_to_an_approximate_distance(): void
    {
        // Uber sends a bare "Dusseldorf Airport" pickup (no street/PLZ) — a single
        // unambiguous POI. It used to resolve as low-confidence 'approx' and withhold
        // the distance; an airport hit is now trusted for an APPROXIMATE distance.
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M3', 'email' => 'm3@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd3',
            'offer_uuid' => 'o3',
            'pickup_address' => 'Dusseldorf Airport',
            'dropoff_address' => 'Rolf-Schwarz-Schütte-Platz, 40789 Monheim am Rhein',
            'fare_formatted' => '35,72 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'o3'],
        ]);

        // The drop-off (has a PLZ) resolves first, then the pickup — an airport hit.
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::sequence()
                ->push([['lat' => '51.09', 'lon' => '6.88']]) // dropoff → 'street'
                ->push([['lat' => '51.28', 'lon' => '6.76', 'class' => 'aeroway', 'type' => 'aerodrome', 'display_name' => 'Düsseldorf Airport, Düsseldorf']]),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [[
                    'distance' => 25400, // 25.4 km
                    'geometry' => ['type' => 'LineString', 'coordinates' => [[6.76, 51.28], [6.88, 51.09]]],
                ]],
            ]),
        ]);

        Sanctum::actingAs($user);

        // Opening an offer QUEUES the geocode (GeocodeOffer) instead of running two
        // Nominatim calls plus an OSRM route inside the GET; the detail renders from
        // what is stored, so the resolved trip shows on the next read.
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk()
            ->assertJsonPath('data.trip.distance_km', 25.4)
            ->assertJsonPath('data.trip.geo_confidence', 'street');
    }

    public function test_bare_hauptbahnhof_pickup_borrows_the_dropoff_city(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        // The real-world failing shape: the supplier sends the pickup as the bare
        // word "Hauptbahnhof" with no city, and a Düsseldorf dropoff. Without the
        // city fill the pickup used to resolve to a Solingen street (the driver's
        // town), inflating the distance and crushing €/km.
        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd1',
            'offer_uuid' => 'hbf1',
            'pickup_address' => 'Hauptbahnhof',
            'dropoff_address' => 'Liegnitzer Str. 4a, 40231 Düsseldorf',
            'fare_formatted' => '10,25 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'hbf1'],
        ]);

        // Dropoff (has a PLZ) resolves first, then the bare pickup. Both land in
        // Düsseldorf; OSRM returns a short intra-city route.
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::sequence()
                ->push([['lat' => '51.2200', 'lon' => '6.7900']])  // dropoff
                ->push([['lat' => '51.2199', 'lon' => '6.7943']]), // Düsseldorf Hbf
            'router.project-osrm.org/*' => Http::response([
                'routes' => [['distance' => 3800, 'geometry' => ['type' => 'LineString', 'coordinates' => [[6.7943, 51.2199], [6.79, 51.22]]]]],
            ]),
        ]);

        Sanctum::actingAs($user);
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();

        // The pickup lookup must carry the borrowed Düsseldorf city — never a bare
        // "Hauptbahnhof" that would drift to the nearest station.
        Http::assertSent(function ($request) {
            $url = urldecode($request->url());

            return str_contains($url, 'nominatim')
                && str_contains($url, 'Hauptbahnhof')
                && str_contains($url, 'sseldorf');
        });
    }

    public function test_uber_waypoints_resolve_an_incomplete_offer_and_flag_multi_stop(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);

        // A street-only offer our geocoder couldn't place (no distance yet).
        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'd1', 'offer_uuid' => 'wp1',
            'pickup_address' => 'Königsberger Straße 66F', 'dropoff_address' => 'Berchemallee 131',
            'fare_formatted' => '12,08 €', 'received_at' => now(), 'raw_payload' => ['offerUUID' => 'wp1'],
            'distance_m' => null, 'geo_confidence' => null,
        ]);

        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response(['display_name' => 'X', 'address' => ['road' => 'Königsberger Straße', 'postcode' => '58285', 'city' => 'Gevelsberg']]),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [['distance' => 8400, 'geometry' => ['type' => 'LineString', 'coordinates' => [[7.33, 51.32], [7.34, 51.33], [7.35, 51.34]]]]],
            ]),
        ]);

        // Uber live-map waypoints: pickup + TWO drop-offs = a multi-stop trip.
        $waypoints = [
            ['lat' => 51.320, 'lng' => 7.330, 'type' => 'PICKUP'],
            ['lat' => 51.330, 'lng' => 7.340, 'type' => 'DROPOFF'],
            ['lat' => 51.340, 'lng' => 7.350, 'type' => 'DROPOFF'],
        ];

        $stops = app(TripGeocoder::class)->applyFromWaypoints($offer, $waypoints);

        $this->assertSame(2, $stops, 'two drop-offs → multi-stop');
        $fresh = $offer->fresh();
        $this->assertSame('uber', $fresh->geo_source);
        $this->assertSame('exact', $fresh->geo_confidence);
        $this->assertSame(2, $fresh->stops_count);
        $this->assertEqualsWithDelta(51.320, (float) $fresh->pickup_lat, 0.0001);
        $this->assertEqualsWithDelta(51.340, (float) $fresh->dropoff_lat, 0.0001); // last waypoint
        $this->assertSame(8400, $fresh->distance_m);
        $this->assertCount(3, $fresh->stops);

        // Idempotent: re-applying the same waypoints does nothing (already from Uber,
        // stop count unchanged).
        $this->assertNull(app(TripGeocoder::class)->applyFromWaypoints($fresh, $waypoints));
    }

    public function test_street_only_end_borrows_the_counterpart_town_for_the_geocode_only(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        // The failing real-world shape: a street-only pickup (no town, no postcode)
        // and a dropoff that names a town but no postcode. Neither end can be placed
        // on its own; the pickup must borrow the dropoff's town for the lookup.
        $city = PostalCodes::city('42103'); // a known town for a real plz (Wuppertal)
        $this->assertNotNull($city, 'test needs a known PLZ');

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd1',
            'offer_uuid' => 'so1',
            'pickup_address' => 'Königsberger Straße 66F',
            'dropoff_address' => "Fachinternistisches Zentrum {$city}",
            'fare_formatted' => '12,08 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'so1'],
        ]);

        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::sequence()
                ->push([['lat' => '51.256', 'lon' => '7.150']])   // pickup (borrowed town)
                ->push([['lat' => '51.260', 'lon' => '7.160']]),  // dropoff
            'router.project-osrm.org/*' => Http::response([
                'routes' => [['distance' => 4200, 'geometry' => ['type' => 'LineString', 'coordinates' => [[7.15, 51.256], [7.16, 51.26]]]]],
            ]),
        ]);

        Sanctum::actingAs($user);
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();

        // The street-only pickup lookup must carry the borrowed town.
        Http::assertSent(function ($request) use ($city) {
            $url = urldecode($request->url());

            return str_contains($url, 'nominatim')
                && str_contains($url, 'nigsberger')
                && str_contains($url, $city);
        });

        // The displayed pickup stays EXACTLY as sent — the borrowed town is a
        // geocode-only bias and must never leak into the address.
        $this->assertSame('Königsberger Straße 66F', $offer->fresh()->pickup_address);
    }

    public function test_missing_postcode_is_filled_only_when_the_town_matches(): void
    {
        $geo = app(TripGeocoder::class);
        $m = new \ReflectionMethod($geo, 'completePostcode');
        $m->setAccessible(true);
        $complete = fn (string $raw, ?string $label) => $m->invoke($geo, $raw, $label !== null ? ['address' => $label] : null);

        $city = PostalCodes::city('10115'); // authoritative town for the plz
        $this->assertNotNull($city, 'test needs a known PLZ');

        // Postcode-less raw, geocoded to the SAME town → the postcode is inserted,
        // the raw town/district name is kept.
        $this->assertSame(
            "Foostraße, 10115 {$city}-Mitte",
            $complete("Foostraße, {$city}-Mitte", "Foostraße, 10115 {$city}"),
        );
        // Already has a postcode → untouched.
        $this->assertSame('Bar 3, 42285 Wuppertal', $complete('Bar 3, 42285 Wuppertal', 'Bar 3, 10115 Berlin'));
        // Geocoded to a DIFFERENT town → left raw (never risk a wrong postcode).
        $this->assertSame('Baz, Solingen', $complete('Baz, Solingen', "Baz, 10115 {$city}"));
    }

    public function test_town_of_recovers_the_base_city_from_a_stadtteil_district_name(): void
    {
        $geo = app(TripGeocoder::class);
        $m = new \ReflectionMethod($geo, 'townOf');
        $m->setAccessible(true);
        $town = fn (string $address) => $m->invoke($geo, $address);

        // A postcode-less address named only by its district ("City-Stadtteil")
        // resolves to its base city — a real listed town — so the street geocodes
        // (Tier 1b) at offer time instead of falling to the free-text 'approx' tier.
        $this->assertSame('Wuppertal', $town('Heckinghauser Str. 102, Wuppertal-Heckinghausen'));
        $this->assertSame('Wuppertal', $town('Am Kiesberg 1, Wuppertal-Elberfeld'));

        // A genuinely hyphenated town is never truncated (its full name is listed).
        $this->assertSame('Castrop-Rauxel', $town('Some Street 1, Castrop-Rauxel'));

        // A street word is still never mistaken for a town.
        $this->assertNull($town('Königsberger Straße 66F'));
    }

    public function test_non_latin_display_falls_back_to_the_german_plz_city_and_leaves_latin_untouched(): void
    {
        $geo = app(TripGeocoder::class);
        $m = new \ReflectionMethod($geo, 'latinDisplay');
        $m->setAccessible(true);
        $latin = fn (?string $current, ?string $raw) => $m->invoke($geo, $current, $raw);

        $city = PostalCodes::city('42781'); // authoritative German town for the plz
        $this->assertNotNull($city, 'test needs a known PLZ');

        // A rider-localized (Japanese) address is unreadable to the driver and must
        // never be shown; the always-Latin PLZ inside it yields the German "<PLZ> City".
        $japanese = 'ドイツ 〒42781 ハーン グルイテン'; // "Germany 42781 Haan-Gruiten"
        $this->assertSame("42781 {$city}", $latin($japanese, $japanese));

        // A normal German address passes through completely unchanged.
        $german = 'Schallbruch 15, 42781 Haan';
        $this->assertSame($german, $latin($german, $german));

        // Non-Latin with no usable postcode → blank beats an unreadable foreign string.
        $this->assertNull($latin('ハーン', 'ハーン'));
    }

    public function test_unresolved_address_with_a_valid_plz_falls_back_to_the_centroid(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        $offer = DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd1',
            'offer_uuid' => 'o2',
            'pickup_address' => 'Nirgendwostraße 999, 10115 Berlin',
            'dropoff_address' => 'Irgendwo 1, 80331 München',
            'fare_formatted' => '20,00 €',
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'o2'],
        ]);

        // Nominatim finds nothing for every tier; OSRM still routes the centroids.
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([]),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [['distance' => 500000, 'geometry' => ['type' => 'LineString', 'coordinates' => [[13.38, 52.52], [11.57, 48.13]]]]],
            ]),
        ]);

        Sanctum::actingAs($user);

        // Opening an offer QUEUES the geocode (GeocodeOffer) instead of running it
        // inside the GET; the detail renders from what is stored, so the resolved
        // trip shows on the next read.
        $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();

        $res = $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();
        // Resolved only to the static PLZ centroids (Berlin ~52.5, Munich ~48.1) →
        // 'postal', not 'exact'. Per the "no guessing" rule the coarse centroids are
        // too rough to trust a distance/€-per-km, so distance stays BLANK until a
        // reliable source fills it (the driver accepts → Uber waypoints).
        $res->assertJsonPath('data.trip.geo_confidence', 'postal');
        $this->assertNotNull($res->json('data.trip.pickup.lat'));
        $this->assertNull($res->json('data.trip.distance_km'), 'centroid-only → no guessed distance');
    }
}
