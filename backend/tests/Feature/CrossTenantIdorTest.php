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

/**
 * Regression guard for the cross-tenant IDOR: a manager of tenant A must never
 * read, mutate, or delete tenant B's route-model-bound resources by id. Both the
 * middleware priority (ResolveTenant before SubstituteBindings) and the explicit
 * authorizeTenant() guard must return 404 for a foreign id.
 */
class CrossTenantIdorTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenantA;

    private Tenant $tenantB;

    private User $managerA;

    private Driver $driverB;

    private DispatchOffer $offerB;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);

        $this->tenantA = Tenant::create(['name' => 'A', 'country' => 'DE']);
        $this->tenantB = Tenant::create(['name' => 'B', 'country' => 'DE']);

        $this->managerA = User::create([
            'name' => 'MA', 'email' => 'ma@a.de',
            'password' => Hash::make('password'), 'tenant_id' => $this->tenantA->id,
        ]);

        // Tenant B's records — created under B's context so tenant_id is B.
        app(TenantContext::class)->set($this->tenantB->id);
        $this->driverB = Driver::create(['name' => 'B-driver', 'email' => 'bd@b.de']);
        $this->offerB = DispatchOffer::create([
            'tenant_id' => $this->tenantB->id,
            'driver_uuid' => 'b-uuid',
            'offer_uuid' => 'b-offer',
            'received_at' => now(),
            'raw_payload' => [],
        ]);
        app(TenantContext::class)->forget();

        Sanctum::actingAs($this->managerA);
    }

    public function test_manager_cannot_read_foreign_driver(): void
    {
        $this->getJson("/api/v1/drivers/{$this->driverB->id}")->assertNotFound();
        $this->getJson("/api/v1/drivers/{$this->driverB->id}/stats")->assertNotFound();
    }

    public function test_manager_cannot_hijack_foreign_driver_email(): void
    {
        $this->patchJson("/api/v1/drivers/{$this->driverB->id}", ['email' => 'attacker@evil.de'])
            ->assertNotFound();

        $this->assertSame('bd@b.de', $this->driverB->fresh()->email);
    }

    public function test_manager_cannot_read_or_delete_foreign_offer(): void
    {
        $this->getJson("/api/v1/dispatch/offers/{$this->offerB->id}")->assertNotFound();
        $this->deleteJson("/api/v1/dispatch/offers/{$this->offerB->id}")->assertNotFound();

        $this->assertNotNull($this->offerB->fresh(), 'foreign offer must survive');
    }
}
