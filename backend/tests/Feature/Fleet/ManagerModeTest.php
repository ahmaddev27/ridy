<?php

namespace Tests\Feature\Fleet;

use App\Domain\Dispatch\DispatchAutoDecline;
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

class ManagerModeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Tenant $other;

    private Driver $manager;

    private Driver $colleague;

    private Driver $foreign;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Mine', true);
        $this->other = $this->makeTenant('Other', true);
        app(TenantContext::class)->set($this->tenant->id);
        $this->manager = $this->makeDriver($this->tenant, 'Boss', 'boss@mine.de');
        $this->colleague = $this->makeDriver($this->tenant, 'Anna', 'anna@mine.de');
        $this->foreign = $this->makeDriver($this->other, 'Fremd', 'fremd@other.de');
        $this->manager->forceFill(['is_manager' => true])->save();
        Sanctum::actingAs($this->manager->fresh(), guard: 'driver');
    }

    private function makeTenant(string $name, bool $reject): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
            'settings' => ['dispatch_reject' => ['enabled' => $reject]],
        ]);
    }

    private function makeDriver(Tenant $tenant, string $name, string $email): Driver
    {
        return Driver::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'name' => $name, 'email' => $email, 'uber_driver_uuid' => 'u-'.$name,
        ]);
    }

    private function user(string $role, string $email = 'owner@mine.de'): User
    {
        $user = User::create([
            'name' => $role, 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $user->assignRole($role);

        return $user;
    }

    public function test_manager_lists_only_own_company_drivers(): void
    {
        $this->getJson('/api/v1/driver/manager/drivers')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonMissing(['name' => 'Fremd']);

        $this->getJson('/api/v1/driver/manager/auto-decline/drivers')
            ->assertOk()
            ->assertJsonPath('data.feature_enabled', true)
            ->assertJsonCount(2, 'data.drivers')
            ->assertJsonMissing(['name' => 'Fremd']);
    }

    public function test_live_positions_exclude_other_companies(): void
    {
        $fix = ['latitude' => 51.2, 'longitude' => 6.8, 'status_synced_at' => now(), 'online_status' => 'ON_TRIP'];
        $this->colleague->forceFill($fix)->save();
        $this->foreign->forceFill($fix)->save();

        $this->getJson('/api/v1/driver/manager/drivers/live')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Anna');
    }

    public function test_manager_cannot_touch_another_companys_driver(): void
    {
        $this->putJson('/api/v1/driver/manager/auto-decline/drivers/'.$this->foreign->id, ['admin_enabled' => true])
            ->assertNotFound();

        $this->assertFalse($this->foreign->fresh()->adminAutoDeclineEnabled());
    }

    public function test_manager_grants_the_admin_permission_to_a_colleague(): void
    {
        $this->putJson('/api/v1/driver/manager/auto-decline/drivers/'.$this->colleague->id, ['admin_enabled' => true])
            ->assertOk()
            ->assertJsonPath('data.admin_enabled', true);

        $this->assertTrue($this->colleague->fresh()->adminAutoDeclineEnabled());
    }

    public function test_write_requires_the_company_dispatch_reject_flag(): void
    {
        $this->tenant->setDispatchRejectEnabled(false);
        $this->tenant->save();
        Sanctum::actingAs($this->manager->fresh(), guard: 'driver');

        $this->putJson('/api/v1/driver/manager/auto-decline/drivers/'.$this->colleague->id, ['admin_enabled' => true])
            ->assertForbidden();

        $this->assertFalse($this->colleague->fresh()->adminAutoDeclineEnabled());
    }

    public function test_non_manager_driver_gets_401_on_every_manager_route(): void
    {
        Sanctum::actingAs($this->colleague->fresh(), guard: 'driver');

        foreach (['drivers', 'drivers/live', 'auto-decline/drivers'] as $path) {
            $this->getJson('/api/v1/driver/manager/'.$path)->assertUnauthorized();
        }
        $this->putJson('/api/v1/driver/manager/auto-decline/drivers/'.$this->colleague->id, ['admin_enabled' => true])
            ->assertUnauthorized();
    }

    public function test_demotion_takes_effect_on_the_next_request(): void
    {
        $this->getJson('/api/v1/driver/manager/drivers')->assertOk();

        Driver::withoutGlobalScopes()->whereKey($this->manager->id)->update(['is_manager' => false]);
        // Same token, re-authenticated per request: the flag is re-read from the DB.
        Sanctum::actingAs(Driver::withoutGlobalScopes()->find($this->manager->id), guard: 'driver');

        $this->getJson('/api/v1/driver/manager/drivers')->assertUnauthorized();
        $this->getJson('/api/v1/driver/me')->assertOk()->assertJsonPath('data.is_manager', false);
    }

    public function test_profile_reports_manager_flag_and_keeps_is_owner_false(): void
    {
        $this->getJson('/api/v1/driver/me')
            ->assertOk()
            ->assertJsonPath('data.is_manager', true)
            ->assertJsonPath('data.is_owner', false);
    }

    public function test_dashboard_owner_promotes_and_demotes_with_an_audit_trail(): void
    {
        Sanctum::actingAs($this->user('owner'));

        $this->patchJson('/api/v1/drivers/'.$this->colleague->id.'/manager', ['is_manager' => true])
            ->assertOk()->assertJsonPath('data.is_manager', true);
        $this->assertTrue((bool) $this->colleague->fresh()->is_manager);
        $this->assertDatabaseHas('audit_logs', ['action' => 'driver.manager_enabled']);

        $this->patchJson('/api/v1/drivers/'.$this->colleague->id.'/manager', ['is_manager' => false])
            ->assertOk()->assertJsonPath('data.is_manager', false);
        $this->assertDatabaseHas('audit_logs', ['action' => 'driver.manager_disabled']);
    }

    public function test_fleet_manager_user_is_refused_the_promote_endpoint(): void
    {
        Sanctum::actingAs($this->user('fleet_manager', 'fm@mine.de'));

        $this->patchJson('/api/v1/drivers/'.$this->colleague->id.'/manager', ['is_manager' => true])
            ->assertForbidden();

        $this->assertFalse((bool) $this->colleague->fresh()->is_manager);
    }

    public function test_owner_cannot_promote_another_companys_driver(): void
    {
        Sanctum::actingAs($this->user('owner'));

        $this->patchJson('/api/v1/drivers/'.$this->foreign->id.'/manager', ['is_manager' => true])
            ->assertNotFound();
    }

    public function test_owner_cannot_change_their_own_driver_record(): void
    {
        Sanctum::actingAs($this->user('owner', 'boss@mine.de'));

        $this->patchJson('/api/v1/drivers/'.$this->manager->id.'/manager', ['is_manager' => false])
            ->assertForbidden();
        $this->assertTrue((bool) $this->manager->fresh()->is_manager);
    }

    public function test_is_manager_is_not_mass_assignable(): void
    {
        $driver = Driver::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Mass', 'is_manager' => true,
        ]);

        $this->assertFalse((bool) $driver->fresh()->is_manager);
    }

    public function test_admin_gate_still_blocks_declines_when_admin_enabled_is_false(): void
    {
        $this->colleague->forceFill(['auto_decline' => [
            'admin_enabled' => false, 'enabled' => true,
            'rules' => ['min_fare' => ['enabled' => true, 'value_e2' => 99900]],
        ]])->save();

        $offer = new DispatchOffer(['fare_amount' => 3.0]);
        $offer->setRelation('tenant', $this->tenant);

        $this->assertNull((new DispatchAutoDecline)->match($offer, $this->colleague->fresh()));

        // Control: the same offer matches once the admin gate is open.
        $open = $this->colleague->fresh();
        $open->auto_decline = array_merge($open->auto_decline, ['admin_enabled' => true]);
        $this->assertSame('min_fare', (new DispatchAutoDecline)->match($offer, $open));
    }
}
