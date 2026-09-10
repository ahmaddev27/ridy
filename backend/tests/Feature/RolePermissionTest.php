<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
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
 * The seeded roles are enforced by `can:` middleware, not decoration: a `viewer`
 * reads the fleet but cannot disconnect Uber, purge offers, edit a driver or
 * invite one. Before this, every dashboard user of a tenant had identical power.
 */
class RolePermissionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA Mobility', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function userWithRole(string $role, string $email): User
    {
        $user = User::create([
            'name' => ucfirst($role), 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => $this->tenant->id,
        ]);
        $user->assignRole($role);

        return $user;
    }

    private function driver(): Driver
    {
        return Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Omar', 'email' => 'omar@ya.de']);
    }

    private function offer(Driver $driver): DispatchOffer
    {
        return DispatchOffer::create([
            'tenant_id' => $driver->tenant_id,
            'driver_id' => $driver->id,
            'driver_uuid' => 'uuid-'.$driver->id,
            'offer_uuid' => 'off-1',
            'received_at' => now(),
            'raw_payload' => [],
            'status' => OfferStatus::Pending,
        ]);
    }

    public function test_viewer_reads_the_offer_feed(): void
    {
        Sanctum::actingAs($this->userWithRole('viewer', 'viewer@ya.de'));

        $this->getJson('/api/v1/dispatch/offers')->assertOk();
        $this->getJson('/api/v1/drivers')->assertOk();
    }

    public function test_viewer_cannot_destroy_the_fleet_or_its_data(): void
    {
        $driver = $this->driver();
        $offer = $this->offer($driver);

        Sanctum::actingAs($this->userWithRole('viewer', 'viewer@ya.de'));

        // Disconnecting Uber purges every driver, vehicle, offer, device and metric.
        $this->deleteJson('/api/v1/fleet-session')->assertStatus(403);
        $this->postJson('/api/v1/fleet-session', [])->assertStatus(403);
        // Offer deletion.
        $this->deleteJson('/api/v1/dispatch/offers/'.$offer->id)->assertStatus(403);
        $this->postJson('/api/v1/dispatch/offers/bulk-delete', ['ids' => [$offer->id]])->assertStatus(403);
        // Driver identity + app invitations.
        $this->patchJson('/api/v1/drivers/'.$driver->id, ['email' => 'attacker@evil.de'])->assertStatus(403);
        $this->postJson('/api/v1/drivers/'.$driver->id.'/invite')->assertStatus(403);
        // The extension token — a viewer must not be able to mint one.
        $this->postJson('/api/v1/extension/token')->assertStatus(403);
        // Governance.
        $this->getJson('/api/v1/audit-logs')->assertStatus(403);

        $this->assertDatabaseHas('dispatch_offers', ['id' => $offer->id]);
        $this->assertDatabaseHas('drivers', ['id' => $driver->id, 'email' => 'omar@ya.de']);
    }

    public function test_fleet_manager_keeps_full_access(): void
    {
        $driver = $this->driver();
        $offer = $this->offer($driver);

        Sanctum::actingAs($this->userWithRole('fleet_manager', 'manager@ya.de'));

        $this->getJson('/api/v1/dispatch/offers')->assertOk();
        $this->getJson('/api/v1/audit-logs')->assertOk();
        $this->patchJson('/api/v1/drivers/'.$driver->id, ['email' => 'omar.b@ya.de'])->assertOk();
        // A body with no email at all is a no-op, not a 500 — and must not clear it.
        $this->patchJson('/api/v1/drivers/'.$driver->id, ['name' => 'ignored'])->assertOk();
        $this->assertDatabaseHas('drivers', ['id' => $driver->id, 'email' => 'omar.b@ya.de']);
        // An explicitly empty email still clears it (the documented way to unset).
        $this->patchJson('/api/v1/drivers/'.$driver->id, ['email' => ''])->assertOk();
        $this->assertDatabaseHas('drivers', ['id' => $driver->id, 'email' => null]);
        $this->deleteJson('/api/v1/dispatch/offers/'.$offer->id)->assertSuccessful();

        $this->assertDatabaseMissing('dispatch_offers', ['id' => $offer->id]);
    }
}
