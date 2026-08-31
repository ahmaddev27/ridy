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

        $res = $this->getJson("/api/v1/dispatch/offers/{$offer->id}")->assertOk();
        // Resolved from the static PLZ centroids (Berlin ~52.5, Munich ~48.1) → postal.
        $res->assertJsonPath('data.trip.geo_confidence', 'postal');
        $this->assertNotNull($res->json('data.trip.pickup.lat'));
        $this->assertNotNull($res->json('data.trip.distance_km'));
    }
}
