<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverLinkTest extends TestCase
{
    use RefreshDatabase;

    private const DRIVER_UUID = 'c0c5a2e2-bfe8-4f04-a6a7-999f4aeba9e0';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA Mobility', 'country' => 'DE']);
        $this->manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function offer(array $overrides = []): DispatchOffer
    {
        return DispatchOffer::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'driver_uuid' => self::DRIVER_UUID,
            'offer_uuid' => 'offer-'.uniqid(),
            'received_at' => now(),
            'driver_first_name' => 'Ahmed',
            'driver_last_name' => 'Hemaid',
            'raw_payload' => [],
        ], $overrides));
    }

    public function test_unlinked_offers_are_backfilled_on_manual_link(): void
    {
        $this->offer();
        $this->offer();
        $driver = Driver::create(['name' => 'Ahmed Hemaid']);

        Sanctum::actingAs($this->manager);

        $this->postJson("/api/v1/drivers/{$driver->id}/link-uber", [
            'uber_driver_uuid' => self::DRIVER_UUID,
            'uber_email' => 'ahmedkhhemaid@gmail.com',
        ])->assertOk()->assertJsonPath('data.backfilled_offers', 2);

        $this->assertSame(0, DispatchOffer::whereNull('driver_id')->count());
        $this->assertSame(self::DRIVER_UUID, $driver->fresh()->uber_driver_uuid);
        $this->assertSame('manual', $driver->fresh()->uber_link_method);
    }

    public function test_auto_link_provisions_driver_and_backfills(): void
    {
        $this->offer();
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/dispatch/auto-link', [
            'uber_driver_uuid' => self::DRIVER_UUID,
            'name' => 'Ahmed Hemaid',
            'email' => 'ahmedkhhemaid@gmail.com',
        ])->assertCreated()
            ->assertJsonPath('data.created', true)
            ->assertJsonPath('data.backfilled_offers', 1);

        $driver = Driver::where('uber_driver_uuid', self::DRIVER_UUID)->firstOrFail();
        $this->assertSame('auto', $driver->uber_link_method);
        $this->assertSame('ahmedkhhemaid@gmail.com', $driver->uber_email);
    }

    public function test_auto_link_reuses_existing_driver_for_same_uuid(): void
    {
        $driver = Driver::create(['name' => 'Ahmed', 'uber_driver_uuid' => self::DRIVER_UUID]);
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/dispatch/auto-link', [
            'uber_driver_uuid' => self::DRIVER_UUID,
            'name' => 'Ahmed Hemaid',
        ])->assertOk()->assertJsonPath('data.created', false);

        $this->assertSame(1, Driver::where('uber_driver_uuid', self::DRIVER_UUID)->count());
        $this->assertSame($driver->id, Driver::where('uber_driver_uuid', self::DRIVER_UUID)->first()->id);
    }

    public function test_unlinked_drivers_list_groups_by_uuid_with_counts(): void
    {
        $this->offer();
        $this->offer();
        Sanctum::actingAs($this->manager);

        $this->getJson('/api/v1/dispatch/unlinked-drivers')
            ->assertOk()
            ->assertJsonPath('data.0.uber_driver_uuid', self::DRIVER_UUID)
            ->assertJsonPath('data.0.name', 'Ahmed Hemaid')
            ->assertJsonPath('data.0.offers', 2);
    }
}
