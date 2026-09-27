<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The admin Network feed is a debug aid: no GPS trail, no contact PII, bounded
 * rows — and supplier ingest payloads are bounded and sanitized.
 */
class NetworkFeedHygieneTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    /** The ingest routes need a connected company (fleet.connected). */
    private function connectedManager(): User
    {
        $org = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';
        $this->tenant->forceFill(['uber_org_uuid' => $org])->save();
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => $org, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        $this->seed(RolePermissionSeeder::class);
        $manager = User::create(['name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $manager->assignRole('fleet_manager');

        return $manager;
    }

    private function statuses(string $status = 'ON_TRIP', array $waypoints = []): array
    {
        return [[
            'driver_uuid' => 'd1', 'status' => $status, 'latitude' => 51.17, 'longitude' => 7.08, 'heading' => 90,
            'location_updated_at' => 1782907200000, 'waypoints' => $waypoints,
        ]];
    }

    public function test_status_rows_carry_no_coordinates(): void
    {
        app(SupplierNetworkRecorder::class)->statuses($this->tenant->id, $this->statuses(waypoints: [['lat' => 51.2, 'lng' => 7.1, 'type' => 'DROPOFF']]));

        $row = DispatchNetworkLog::where('kind', 'status')->firstOrFail()->payload[0];
        $this->assertArrayNotHasKey('latitude', $row);
        $this->assertArrayNotHasKey('heading', $row);
        $this->assertTrue($row['has_location']);
        $this->assertSame(['DROPOFF'], $row['waypoints']);
    }

    public function test_unchanged_status_batches_are_throttled_but_changes_and_vias_are_kept(): void
    {
        $recorder = app(SupplierNetworkRecorder::class);

        $recorder->statuses($this->tenant->id, $this->statuses());
        $recorder->statuses($this->tenant->id, $this->statuses()); // same minute, nothing new
        $this->assertSame(1, DispatchNetworkLog::where('kind', 'status')->count());

        $recorder->statuses($this->tenant->id, $this->statuses('ONLINE')); // status changed
        $recorder->statuses($this->tenant->id, $this->statuses('ONLINE', [['lat' => 1, 'lng' => 1, 'type' => 'CHECKPOINT_TYPE_VIA']])); // multi-stop audit
        $this->assertSame(3, DispatchNetworkLog::where('kind', 'status')->count());
    }

    public function test_roster_rows_drop_contact_details(): void
    {
        app(SupplierNetworkRecorder::class)->roster($this->tenant->id, [[
            'driverUuid' => 'x', 'name' => ['firstName' => 'A'], 'email' => 'a@b.de', 'phoneNumber' => ['number' => '1'], 'pictureUrl' => 'https://p',
        ]]);

        $row = DispatchNetworkLog::where('kind', 'roster')->firstOrFail()->payload[0];
        // MySQL's JSON type re-orders object keys, so compare the set, not the order.
        $this->assertEqualsCanonicalizing(['driverUuid', 'name'], array_keys($row));
    }

    public function test_an_oversized_capture_is_stored_as_a_marker(): void
    {
        DispatchNetworkLog::record($this->tenant->id, 'reports', ['blob' => str_repeat('x', DispatchNetworkLog::MAX_PAYLOAD_BYTES + 10)]);

        $this->assertTrue(DispatchNetworkLog::firstOrFail()->payload['truncated']);
    }

    public function test_status_rows_are_pruned_sooner_than_the_rest(): void
    {
        DispatchNetworkLog::record($this->tenant->id, 'status', ['a' => 1]);
        DispatchNetworkLog::record($this->tenant->id, 'offer', ['a' => 1]);
        DispatchNetworkLog::query()->update(['created_at' => now()->subHours(10)]);

        $this->artisan('network-logs:prune')->assertSuccessful();

        $this->assertSame(['offer'], DispatchNetworkLog::pluck('kind')->all());
    }

    public function test_vehicle_sync_sanitizes_fields_instead_of_failing(): void
    {
        Sanctum::actingAs($this->connectedManager());

        $this->postJson('/api/v1/vehicles', ['vehicles' => [[
            'uber_vehicle_uuid' => 'v1', 'license_plate' => ['nested'], 'image_url' => 'http://tracker.example/x.png',
            'color_hex' => 'red;}', 'make' => 'Toyota', 'year' => '2021',
        ]]])->assertOk()->assertJsonPath('data.synced', 1);

        $vehicle = Vehicle::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($vehicle->license_plate);
        $this->assertNull($vehicle->image_url);
        $this->assertNull($vehicle->color_hex);
        $this->assertSame('Toyota', $vehicle->make);
        $this->assertSame(2021, (int) $vehicle->year);
    }

    public function test_an_oversized_supplier_capture_is_rejected(): void
    {
        Sanctum::actingAs($this->connectedManager());

        $this->postJson('/api/v1/supplier/capture', ['kind' => 'reports', 'payload' => ['blob' => str_repeat('x', 2 * 1024 * 1024 + 1)]])
            ->assertStatus(413);
    }
}
