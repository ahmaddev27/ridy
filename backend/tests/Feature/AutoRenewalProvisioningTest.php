<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AutoRenewalProvisioningTest extends TestCase
{
    use RefreshDatabase;

    private function tenant(bool $passwordless = true, bool $proxy = true, bool $context = true): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(),
            'proxy_url' => $proxy ? 'http://u:p@proxy.test:8000' : null,
            'settings' => ['passwordless_login' => ['enabled' => $passwordless]],
        ]);
        if ($context) {
            SessionBrowser::create(['tenant_id' => $tenant->id, 'state' => SessionBrowser::STATE_ACTIVE]);
        }

        return $tenant;
    }

    private function asSuperAdmin(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.passwordless_login.enabled' => true, 'services.passwordless_login.tenants' => []]);
    }

    public function test_the_address_is_minted_lazily_stable_and_switches_auto_on(): void
    {
        $tenant = $this->tenant();
        $settings = app(PasswordlessLoginSettings::class);
        $this->assertNull($settings->inboundAddress($tenant));

        $address = $settings->ensureInboundAddress($tenant);
        $this->assertMatchesRegularExpression('/^uber-[a-z0-9]{26}@/', $address);
        $this->assertSame($address, $settings->ensureInboundAddress($tenant->refresh()));
        $this->assertTrue($settings->autoCodeEnabled($tenant));
        // only the encrypted token + hash are stored, never the plain address
        $this->assertStringNotContainsString(substr($address, 5, 26), json_encode($tenant->settings));
    }

    public function test_each_company_gets_its_own_address(): void
    {
        $settings = app(PasswordlessLoginSettings::class);

        $this->assertNotSame($settings->ensureInboundAddress($this->tenant()), $settings->ensureInboundAddress($this->tenant()));
    }

    public function test_super_admin_reads_the_address_and_state_without_any_input(): void
    {
        $this->asSuperAdmin();
        $tenant = $this->tenant();
        $url = "/api/v1/admin/companies/{$tenant->id}/auto-renewal";

        $address = $this->getJson($url)->assertOk()
            ->assertJsonPath('data.eligible', true)->assertJsonPath('data.email_known', false)
            ->json('data.inbound_address');
        $this->assertMatchesRegularExpression('/^uber-[a-z0-9]{26}@/', $address);
        $this->getJson($url)->assertJsonPath('data.inbound_address', $address);

        $this->getJson("/api/v1/admin/companies/{$this->tenant(proxy: false)->id}/auto-renewal")
            ->assertOk()->assertJsonPath('data.eligible', false)->assertJsonPath('data.blocker', 'no_proxy');
        $this->patchJson($url, ['enabled' => true, 'email' => 'a@b.de'])->assertStatus(405);
    }

    public function test_a_manager_is_forbidden(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = $this->tenant();
        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        $this->getJson("/api/v1/admin/companies/{$tenant->id}/auto-renewal")->assertForbidden();
    }
}
