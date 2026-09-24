<?php

namespace Tests\Feature\Fleet;

use App\Domain\Dispatch\Jobs\SyncTripFromWaypoints;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Status ingest runs every few seconds per company: it must not write unchanged
 * drivers, must not enqueue no-op trip syncs, and must never let an older batch
 * (the slower of the two sources) roll a driver back and fake a lifecycle edge.
 */
class StatusIngestEfficiencyTest extends TestCase
{
    use RefreshDatabase;

    private const UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function driver(array $overrides = []): Driver
    {
        return Driver::create(array_merge([
            'tenant_id' => $this->tenant->id, 'name' => 'Basel',
            'uber_driver_uuid' => self::UUID, 'online_status' => 'MONITORING_SUPPLY_STATUS_ONLINE',
        ], $overrides));
    }

    private function ingest(array $row): array
    {
        return app(DriverStatusIngestor::class)->ingest($this->tenant->id, [array_merge(['driver_uuid' => self::UUID], $row)]);
    }

    private function driverUpdates(callable $fn): int
    {
        $count = 0;
        DB::listen(function ($q) use (&$count) {
            if (str_starts_with(strtolower($q->sql), 'update "drivers"')) {
                $count++;
            }
        });
        $fn();

        return $count;
    }

    public function test_an_unchanged_status_batch_writes_nothing(): void
    {
        $this->driver();
        $row = ['status' => 'MONITORING_SUPPLY_STATUS_ONLINE', 'location_updated_at' => 1782907200000];

        $this->ingest($row); // first sighting writes (location + heartbeat)

        $this->assertSame(0, $this->driverUpdates(fn () => $this->ingest($row)), 'an identical batch within the heartbeat window must not UPDATE drivers');
    }

    public function test_a_stale_heartbeat_is_bumped_in_one_bulk_update(): void
    {
        $driver = $this->driver();
        $row = ['status' => 'MONITORING_SUPPLY_STATUS_ONLINE'];
        $this->ingest($row);
        Driver::withoutGlobalScopes()->whereKey($driver->id)->update(['status_synced_at' => now()->subMinutes(5)]);

        $this->assertSame(1, $this->driverUpdates(fn () => $this->ingest($row)));
        $this->assertTrue($driver->fresh()->status_synced_at->greaterThan(now()->subMinute()));
    }

    public function test_a_real_change_still_writes_and_drives_the_lifecycle(): void
    {
        $this->driver();
        $offer = DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => self::UUID, 'offer_uuid' => 'o1',
            'received_at' => now()->subMinute(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);

        $result = $this->ingest(['status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE']);

        $this->assertSame(1, $result['accepted']);
        $this->assertSame('MONITORING_SUPPLY_STATUS_EN_ROUTE', Driver::withoutGlobalScopes()->first()->online_status);
        $this->assertSame(OfferStatus::Accepted, $offer->fresh()->status);
    }

    public function test_an_older_fix_never_rolls_the_driver_back(): void
    {
        $this->driver();
        $offer = DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => self::UUID, 'offer_uuid' => 'o1',
            'received_at' => now()->subMinute(), 'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);
        $newer = now()->subSeconds(5)->getTimestampMs();
        $older = now()->subSeconds(40)->getTimestampMs();

        // The daemon's fresh EN_ROUTE accepts the offer…
        $this->ingest(['status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE', 'location_updated_at' => $newer]);
        // …then the extension's older idle snapshot arrives late: it must be ignored.
        $this->ingest(['status' => 'MONITORING_SUPPLY_STATUS_ONLINE', 'location_updated_at' => $older]);

        $this->assertSame('MONITORING_SUPPLY_STATUS_EN_ROUTE', Driver::withoutGlobalScopes()->first()->online_status);
        $this->assertSame(OfferStatus::Accepted, $offer->fresh()->status, 'a stale idle row must not cancel the accepted offer');
    }

    public function test_location_timestamps_are_stored_as_berlin_wall_clock(): void
    {
        $this->driver();
        // 2026-07-01 12:00:00 UTC = 14:00 Europe/Berlin (CEST).
        $this->ingest(['status' => 'MONITORING_SUPPLY_STATUS_ONLINE', 'location_updated_at' => 1782907200000]);

        $raw = DB::table('drivers')->value('location_updated_at');
        $this->assertStringStartsWith('2026-07-01 14:00:00', (string) $raw);
    }

    public function test_the_trip_sync_is_not_re_enqueued_for_an_already_resolved_waypoint_list(): void
    {
        Queue::fake();
        $this->driver(['online_status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE']);
        $waypoints = [['lat' => 51.17, 'lng' => 7.08, 'type' => 'PICKUP'], ['lat' => 51.2, 'lng' => 7.1, 'type' => 'DROPOFF']];
        $row = ['status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE', 'latitude' => 51.16, 'longitude' => 7.07, 'waypoints' => $waypoints];

        $this->ingest($row);
        Queue::assertPushed(SyncTripFromWaypoints::class, 1); // new list → resolve

        // The job ran (releasing its unique lock) and resolved this list (marker).
        Cache::lock('laravel_unique_job:'.SyncTripFromWaypoints::class.':sync-waypoints:'.$this->tenant->id.':'.self::UUID)->forceRelease();
        Cache::put(SyncTripFromWaypoints::syncedMarkerKey($this->tenant->id, self::UUID), 2, 600);
        $this->ingest($row);
        Queue::assertPushed(SyncTripFromWaypoints::class, 1); // unchanged → no churn

        // A stop is added → resolve again.
        $row['waypoints'][] = ['lat' => 51.3, 'lng' => 7.2, 'type' => 'DROPOFF'];
        $this->ingest($row);
        Queue::assertPushed(SyncTripFromWaypoints::class, 2);
    }

    public function test_waypoints_are_capped_on_the_driver_row(): void
    {
        Queue::fake();
        $this->driver(['online_status' => 'MONITORING_SUPPLY_STATUS_EN_ROUTE']);
        $waypoints = array_map(fn ($i) => ['lat' => 51 + $i / 1000, 'lng' => 7.0, 'type' => 'VIA'], range(1, 40));

        $this->ingest(['status' => 'MONITORING_SUPPLY_STATUS_ON_TRIP', 'latitude' => 51.1, 'longitude' => 7.1, 'waypoints' => $waypoints]);

        $this->assertCount(DriverStatusIngestor::MAX_WAYPOINTS, Driver::withoutGlobalScopes()->first()->trip_waypoints);
    }

    public function test_positions_are_purged_once_status_sync_stops(): void
    {
        $stale = $this->driver(['uber_driver_uuid' => 'stale', 'latitude' => 51.1, 'longitude' => 7.1, 'trip_waypoints' => [['lat' => 51.2, 'lng' => 7.2]]]);
        Driver::withoutGlobalScopes()->whereKey($stale->id)->update(['status_synced_at' => now()->subMinutes(11)]);
        $live = $this->driver(['uber_driver_uuid' => 'live', 'latitude' => 51.3, 'longitude' => 7.3]);
        Driver::withoutGlobalScopes()->whereKey($live->id)->update(['status_synced_at' => now()->subMinute()]);

        $this->artisan('fleet:purge-stale-locations')->assertSuccessful();

        $stale = $stale->fresh();
        $this->assertNull($stale->latitude);
        $this->assertNull($stale->trip_waypoints);
        $this->assertSame('MONITORING_SUPPLY_STATUS_ONLINE', $stale->online_status);
        $this->assertNotNull($live->fresh()->latitude);
    }

    public function test_a_slow_text_geocode_never_overwrites_an_uber_resolved_trip(): void
    {
        $offer = DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => self::UUID, 'offer_uuid' => 'o-geo',
            'pickup_address' => 'Irgendwostraße 1', 'dropoff_address' => 'Nirgendwoweg 2',
            'received_at' => now(), 'raw_payload' => [], 'status' => OfferStatus::Accepted,
        ]);
        $stale = DispatchOffer::withoutGlobalScopes()->find($offer->id); // loaded before the resolve

        // Meanwhile SyncTripFromWaypoints stored Uber's exact trip.
        DispatchOffer::withoutGlobalScopes()->whereKey($offer->id)->update([
            'geo_source' => 'uber', 'pickup_lat' => 51.17, 'pickup_lng' => 7.08,
            'distance_m' => 4321, 'geo_confidence' => 'exact', 'geo_synced_at' => now(),
        ]);

        app(TripGeocoder::class)->enrich($stale);

        $fresh = $offer->fresh();
        $this->assertSame(4321, $fresh->distance_m);
        $this->assertSame('exact', $fresh->geo_confidence);
        $this->assertSame(51.17, $fresh->pickup_lat);
    }

    public function test_only_one_overlapping_waypoint_resolve_claims_the_multi_stop_update(): void
    {
        $offer = DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => self::UUID, 'offer_uuid' => 'o-ms',
            'received_at' => now(), 'raw_payload' => [], 'status' => OfferStatus::Accepted,
        ]);
        $waypoints = [
            ['lat' => 51.17, 'lng' => 7.08, 'type' => 'PICKUP'],
            ['lat' => 51.20, 'lng' => 7.10, 'type' => 'VIA'],
            ['lat' => 51.25, 'lng' => 7.15, 'type' => 'DROPOFF'],
        ];
        $a = DispatchOffer::withoutGlobalScopes()->find($offer->id);
        $b = DispatchOffer::withoutGlobalScopes()->find($offer->id);

        $geo = app(TripGeocoder::class);
        $this->assertSame(2, $geo->applyFromWaypoints($a, $waypoints));
        $this->assertNull($geo->applyFromWaypoints($b, $waypoints), 'the second, overlapping run must not claim (no duplicate multi-stop push)');
    }
}
