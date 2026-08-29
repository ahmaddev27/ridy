<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
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
        $this->assertNotNull($offer->fresh()->geo_synced_at);
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
