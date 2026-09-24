<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Jobs\BackfillWaypointLabels;
use App\Domain\Dispatch\Jobs\GeocodeOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The single worker must not fill with duplicate or unbounded geo jobs. */
class QueueHygieneTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_cold_offer_is_geocoded_by_one_job_at_a_time(): void
    {
        Queue::fake();

        GeocodeOffer::dispatch(42);
        GeocodeOffer::dispatch(42); // a second manager tab opens the same offer
        GeocodeOffer::dispatch(43);

        Queue::assertPushed(GeocodeOffer::class, 2);
    }

    public function test_live_map_polls_queue_each_cold_waypoint_once_in_bounded_jobs(): void
    {
        Queue::fake();
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($tenant->id);
        $manager = User::create(['name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        $waypoints = array_map(fn ($i) => ['lat' => 51.1 + $i / 100, 'lng' => 7.0 + $i / 100, 'type' => 'VIA'], range(1, 10));
        Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'D', 'online_status' => 'ON_TRIP',
            'latitude' => 51.1, 'longitude' => 7.0, 'status_synced_at' => now(), 'trip_waypoints' => $waypoints,
        ]);
        Sanctum::actingAs($manager);

        $this->getJson('/api/v1/drivers/live')->assertOk();
        $this->getJson('/api/v1/drivers/live')->assertOk(); // the next 12 s poll

        // 10 cold points → 2 jobs of ≤ 8, and the second poll queues nothing new.
        Queue::assertPushed(BackfillWaypointLabels::class, 2);
    }
}
