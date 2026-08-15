<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferLifecycle;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OfferReconcileTest extends TestCase
{
    use RefreshDatabase;

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);

        $manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);
    }

    private function driver(): Driver
    {
        return Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Basel',
            'uber_driver_uuid' => self::DRIVER_UUID, 'online_status' => 'MONITORING_SUPPLY_STATUS_ONLINE',
        ]);
    }

    private function offer(array $overrides = []): DispatchOffer
    {
        return DispatchOffer::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'driver_uuid' => self::DRIVER_UUID,
            'offer_uuid' => 'offer-'.uniqid(),
            'received_at' => now()->subMinute(),
            'raw_payload' => [],
        ], $overrides));
    }

    private function postStatus(string $s): void
    {
        $this->postJson('/api/v1/drivers/statuses', [
            'statuses' => [['driver_uuid' => self::DRIVER_UUID, 'status' => "MONITORING_SUPPLY_STATUS_{$s}"]],
        ])->assertOk();
    }

    public function test_back_to_back_completes_the_current_trip_and_accepts_the_next(): void
    {
        // The bug: a busy driver never returns idle between trips, so the
        // ON_TRIP → EN_ROUTE edge must complete the current trip AND accept the
        // next offer (which arrived during it) — otherwise the first sticks forever.
        $this->driver();
        $first = $this->offer(['received_at' => now()->subMinutes(3)]);

        $this->postStatus('EN_ROUTE'); // first accepted
        $this->postStatus('ON_TRIP');  // first started
        $this->assertSame(OfferStatus::Started, $first->fresh()->status);

        // The next offer arrives while the driver is on the first trip.
        $second = $this->offer(['received_at' => now()]);

        // Driver drops the rider and heads to the next pickup.
        $this->postStatus('EN_ROUTE');

        $this->assertSame(OfferStatus::Completed, $first->fresh()->status, 'first trip completed');
        $this->assertSame(OfferStatus::Accepted, $second->fresh()->status, 'next offer accepted');
    }

    public function test_back_to_back_never_grabs_an_offer_from_before_the_trip(): void
    {
        $this->driver();
        $stalePreTrip = $this->offer(['received_at' => now()->subMinutes(20)]); // old, never taken
        $active = $this->offer(['received_at' => now()->subMinutes(3)]);

        $this->postStatus('EN_ROUTE'); // accepts the most recent pending = $active
        $this->postStatus('ON_TRIP');
        $this->postStatus('EN_ROUTE'); // 2→1: complete active; no NEWER pending exists

        // The pre-trip offer must stay untouched (not attributed to this driver's next trip).
        $this->assertNull($stalePreTrip->fresh()->accepted_at);
        $this->assertSame(OfferStatus::Completed, $active->fresh()->status);
    }

    public function test_finalizer_completes_an_over_long_trip(): void
    {
        $this->driver();
        $stuck = $this->offer([
            'status' => OfferStatus::Started,
            'accepted_at' => now()->subMinutes(105),
            'started_at' => now()->subMinutes(101), // past MAX_TRIP_MINUTES (100)
        ]);

        $changed = app(OfferLifecycle::class)->finalizeStale();

        $this->assertSame(1, $changed);
        $this->assertSame(OfferStatus::Completed, $stuck->fresh()->status);
        $this->assertNotNull($stuck->fresh()->completed_at);
    }

    public function test_finalizer_cancels_an_abandoned_accepted_offer(): void
    {
        $this->offer([
            'status' => OfferStatus::Accepted,
            'accepted_at' => now()->subMinutes(25), // never started, past ACCEPTED_STALE_MINUTES (20)
        ]);

        app(OfferLifecycle::class)->finalizeStale();

        $offer = DispatchOffer::withoutGlobalScopes()->first();
        $this->assertSame(OfferStatus::Canceled, $offer->status);
    }

    public function test_finalizer_leaves_a_normal_in_progress_trip_alone(): void
    {
        $this->offer([
            'status' => OfferStatus::Started,
            'accepted_at' => now()->subMinutes(10),
            'started_at' => now()->subMinutes(8), // well within the max
        ]);

        $this->assertSame(0, app(OfferLifecycle::class)->finalizeStale());
    }

    public function test_geocode_transient_failure_leaves_the_offer_retryable(): void
    {
        Http::fake(['nominatim.openstreetmap.org/*' => Http::response('', 429)]); // rate-limited

        $offer = $this->offer(['pickup_address' => 'A Str 1', 'dropoff_address' => 'B Str 2']);
        app(TripGeocoder::class)->enrich($offer->fresh());

        $offer->refresh();
        $this->assertNull($offer->geo_synced_at, 'not marked done, so it retries');
        $this->assertSame(1, $offer->geo_attempts);
        // The transient miss must NOT be cached, or a retry could never succeed.
        $this->assertDatabaseMissing('geocode_cache', ['query' => 'A Str 1']);
    }

    public function test_geocode_success_marks_the_offer_synced_with_distance(): void
    {
        Http::fake([
            'nominatim.openstreetmap.org/*' => Http::response([['lat' => '51.34', 'lon' => '7.04']], 200),
            'router.project-osrm.org/*' => Http::response([
                'routes' => [['distance' => 4820, 'geometry' => ['type' => 'LineString', 'coordinates' => []]]],
            ], 200),
        ]);

        $offer = $this->offer(['pickup_address' => 'A Str 1', 'dropoff_address' => 'B Str 2']);
        app(TripGeocoder::class)->enrich($offer->fresh());

        $offer->refresh();
        $this->assertNotNull($offer->geo_synced_at);
        $this->assertSame(4820, $offer->distance_m);
    }
}
