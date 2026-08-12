<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use App\Support\Settings;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SubscriptionActivationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    private function owner(Tenant $tenant): User
    {
        return User::create([
            'name' => 'Owner', 'email' => 'owner@acme.de', 'phone' => '+49123',
            'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
    }

    private function superAdmin(): User
    {
        $admin = User::create([
            'name' => 'Admin', 'email' => 'admin@reidey.app',
            'password' => Hash::make('password'), 'tenant_id' => null,
        ]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_login_is_blocked_for_a_disabled_company_with_a_reason(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'disabled']);
        $this->owner($tenant);

        $this->postJson('/api/v1/login', ['email' => 'owner@acme.de', 'password' => 'password'])
            ->assertStatus(403)->assertJsonPath('reason', 'disabled');
    }

    public function test_login_is_blocked_for_an_expired_subscription(): void
    {
        $tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active',
            'subscription_ends_at' => CarbonImmutable::now()->subDay(),
        ]);
        $this->owner($tenant);

        $this->postJson('/api/v1/login', ['email' => 'owner@acme.de', 'password' => 'password'])
            ->assertStatus(403)->assertJsonPath('reason', 'expired');
    }

    public function test_active_company_within_subscription_logs_in(): void
    {
        $tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active',
            'subscription_ends_at' => CarbonImmutable::now()->addDays(10),
        ]);
        $this->owner($tenant);

        $this->postJson('/api/v1/login', ['email' => 'owner@acme.de', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.email', 'owner@acme.de');
    }

    public function test_owner_activates_with_the_correct_code_and_gets_a_subscription(): void
    {
        $tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active',
            'subscription_ends_at' => CarbonImmutable::now()->subDay(),
        ]);
        $tenant->forceFill([
            'activation_code' => '123456',
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(2),
            'activation_days' => 30,
        ])->save();
        $this->owner($tenant);

        $this->postJson('/api/v1/company/activate', [
            'email' => 'owner@acme.de', 'password' => 'password', 'code' => '123456',
        ])->assertOk()->assertJsonPath('data.activated', true);

        $tenant->refresh();
        $this->assertNull($tenant->activation_code);
        $this->assertTrue($tenant->subscription_ends_at->isFuture());
        $this->assertTrue($tenant->isUsable());
    }

    public function test_three_wrong_codes_ban_the_company(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $tenant->forceFill([
            'activation_code' => '123456',
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(2),
            'activation_days' => 30,
        ])->save();
        $this->owner($tenant);

        for ($i = 0; $i < 2; $i++) {
            $this->postJson('/api/v1/company/activate', [
                'email' => 'owner@acme.de', 'password' => 'password', 'code' => '000000',
            ])->assertStatus(422);
        }

        // Third wrong code bans the account.
        $this->postJson('/api/v1/company/activate', [
            'email' => 'owner@acme.de', 'password' => 'password', 'code' => '000000',
        ])->assertStatus(403)->assertJsonPath('reason', 'banned');

        $this->assertNotNull($tenant->refresh()->banned_at);
    }

    public function test_admin_generates_a_code_then_reactivates_a_banned_company(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 50, 'duration_days' => 30, 'active' => true]);

        $this->postJson("/api/v1/admin/companies/{$tenant->id}/activation", ['plan_id' => $plan->id])
            ->assertOk()->assertJsonPath('data.days', 30);
        $this->assertNotNull($tenant->refresh()->activation_code);

        $tenant->forceFill(['banned_at' => CarbonImmutable::now(), 'status' => 'disabled'])->save();

        $this->postJson("/api/v1/admin/companies/{$tenant->id}/reactivate")
            ->assertOk()->assertJsonPath('data.reactivated', true);

        $tenant->refresh();
        $this->assertNull($tenant->banned_at);
        $this->assertSame('active', $tenant->status);
    }

    public function test_admin_banned_list_includes_the_owner_phone(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $tenant->forceFill(['banned_at' => CarbonImmutable::now()])->save();
        $this->owner($tenant);

        $this->getJson('/api/v1/admin/banned-companies')
            ->assertOk()
            ->assertJsonPath('data.0.owner_phone', '+49123')
            ->assertJsonPath('data.0.name', 'Acme');
    }

    public function test_support_contacts_round_trip_through_admin_settings(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->putJson('/api/v1/admin/settings', [
            'support_email' => 'help@reidey.app', 'support_whatsapp' => '+491700000000',
        ])->assertOk()->assertJsonPath('data.support_email', 'help@reidey.app');

        $this->assertSame('+491700000000', Settings::get('support_whatsapp'));
    }
}
