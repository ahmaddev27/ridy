<?php

namespace Tests\Feature\Platform;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Privacy\DriverEraser;
use App\Domain\Privacy\RetentionPolicy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DataRetentionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function offer(array $attrs = []): DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()->create($attrs + [
            'tenant_id' => $this->tenant->id, 'driver_uuid' => 'uber-1', 'offer_uuid' => 'o'.uniqid(),
            'rider_first_name' => 'Peter', 'pickup_address' => 'Hauptstraße 1, 42651 Solingen',
            'dropoff_address' => 'Bahnhofstraße 2, 42651 Solingen', 'pickup_lat' => 51.1, 'pickup_lng' => 7.1,
            'fare_amount' => 12.5, 'distance_m' => 3000,
            'received_at' => now(), 'raw_payload' => ['rider' => 'Peter'], 'status' => OfferStatus::Completed,
        ]);
    }

    public function test_nothing_is_touched_while_every_period_is_unset(): void
    {
        $old = $this->offer(['received_at' => now()->subYears(3)]);

        $this->artisan('data:retention')->assertSuccessful();

        $old->refresh();
        $this->assertSame('Peter', $old->rider_first_name);
        $this->assertNotNull($old->pickup_address);
    }

    public function test_old_offers_are_anonymized_keeping_business_figures(): void
    {
        Settings::setMany([RetentionPolicy::OFFER_MONTHS => '12']);
        $old = $this->offer(['received_at' => now()->subMonths(13)]);
        $recent = $this->offer(['received_at' => now()->subMonths(2)]);

        $this->artisan('data:retention', ['--dry-run' => true])->assertSuccessful();
        $this->assertSame('Peter', $old->fresh()->rider_first_name, 'dry run changes nothing');

        $this->artisan('data:retention')->assertSuccessful();

        $old->refresh();
        $this->assertNull($old->rider_first_name);
        $this->assertNull($old->pickup_address);
        $this->assertNull($old->pickup_lat);
        $this->assertSame([], (array) $old->raw_payload);
        $this->assertSame(12.5, (float) $old->fare_amount);
        $this->assertSame(3000, (int) $old->distance_m);
        $this->assertNotNull(DB::table('dispatch_offers')->where('id', $old->id)->value('anonymized_at'));

        $this->assertSame('Peter', $recent->fresh()->rider_first_name);
    }

    public function test_old_driver_metrics_are_deleted_when_enabled(): void
    {
        Settings::setMany([RetentionPolicy::DRIVER_METRIC_MONTHS => '24']);
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'D']);
        DriverMetric::create(['tenant_id' => $this->tenant->id, 'driver_id' => $driver->id, 'period_start' => now()->subYears(3), 'period_end' => now()->subYears(3)->addWeek()]);
        DriverMetric::create(['tenant_id' => $this->tenant->id, 'driver_id' => $driver->id, 'period_start' => now()->subWeek(), 'period_end' => now()]);

        $this->artisan('data:retention')->assertSuccessful();

        $this->assertSame(1, DriverMetric::withoutGlobalScopes()->count());
    }

    public function test_erasing_one_driver_unlinks_and_strips_their_data_only(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@x.de', 'uber_driver_uuid' => 'uber-1']);
        $other = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Ali', 'uber_driver_uuid' => 'uber-2']);
        DeviceToken::create(['driver_id' => $driver->id, 'token' => 'tok-omar', 'tenant_id' => $this->tenant->id]);
        $driver->createToken('app');
        $theirs = $this->offer(['driver_id' => $driver->id]);
        $others = $this->offer(['driver_id' => $other->id, 'driver_uuid' => 'uber-2']);

        app(DriverEraser::class)->erase($driver);

        $this->assertNull(Driver::withoutGlobalScopes()->find($driver->id));
        $this->assertSame(0, DeviceToken::withoutGlobalScopes()->where('token', 'tok-omar')->count());
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $driver->id)->where('tokenable_type', $driver->getMorphClass())->count());

        $theirs->refresh();
        $this->assertNull($theirs->driver_id);
        $this->assertSame(DriverEraser::ERASED_UUID, $theirs->driver_uuid);
        $this->assertNull($theirs->rider_first_name);
        $this->assertSame(12.5, (float) $theirs->fare_amount);

        $this->assertSame($other->id, $others->fresh()->driver_id);
        $this->assertSame('Peter', $others->fresh()->rider_first_name);
    }

    public function test_drivers_removed_from_the_roster_long_ago_are_erased_when_enabled(): void
    {
        Settings::setMany([RetentionPolicy::REMOVED_DRIVER_MONTHS => '6']);
        $gone = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Gone', 'roster_removed_at' => now()->subMonths(7)]);
        $recent = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Recent', 'roster_removed_at' => now()->subMonth()]);
        $active = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Active']);

        $this->artisan('data:retention')->assertSuccessful();

        $this->assertNull(Driver::withoutGlobalScopes()->find($gone->id));
        $this->assertNotNull(Driver::withoutGlobalScopes()->find($recent->id));
        $this->assertNotNull(Driver::withoutGlobalScopes()->find($active->id));
    }

    public function test_erase_command_requires_the_matching_company(): void
    {
        $driver = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar']);
        $otherTenant = Tenant::create(['name' => 'Other', 'country' => 'DE']);

        $this->artisan('drivers:erase', ['driver' => $driver->id, '--tenant' => $otherTenant->id, '--force' => true])->assertFailed();
        $this->assertNotNull(Driver::withoutGlobalScopes()->find($driver->id));

        $this->artisan('drivers:erase', ['driver' => $driver->id, '--tenant' => $this->tenant->id, '--force' => true])->assertSuccessful();
        $this->assertNull(Driver::withoutGlobalScopes()->find($driver->id));
    }
}
