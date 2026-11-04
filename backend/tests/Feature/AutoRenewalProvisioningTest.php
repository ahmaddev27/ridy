<?php

namespace Tests\Feature;

use App\Domain\Audit\Models\AuditLog;
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

    public function test_provision_and_deprovision_flip_the_flags(): void
    {
        $tenant = $this->tenant();
        $settings = app(PasswordlessLoginSettings::class);

        $address = $settings->provisionAuto($tenant, 'ops@acme.de');
        $this->assertMatchesRegularExpression('/^uber-[a-z0-9]{26}@/', $address);
        $this->assertTrue($settings->inboundConfigured($tenant));
        $this->assertTrue($settings->autoReloginEnabled($tenant->refresh()));
        $this->assertNotSame($address, $settings->provisionAuto($tenant, 'ops@acme.de'));

        $settings->deprovisionAuto($tenant);
        $this->assertFalse($settings->autoCodeEnabled($tenant->refresh()));
        $this->assertFalse($settings->autoReloginEnabled($tenant));
    }

    public function test_super_admin_enables_and_disables(): void
    {
        $this->asSuperAdmin();
        $tenant = $this->tenant();

        $address = $this->patchJson("/api/v1/admin/companies/{$tenant->id}/auto-renewal", ['enabled' => true, 'email' => 'ops@acme.de'])
            ->assertOk()->json('data.inbound_address');
        $this->assertMatchesRegularExpression('/^uber-[a-z0-9]{26}@/', $address);
        $this->assertTrue(app(PasswordlessLoginSettings::class)->autoReloginEnabled($tenant->refresh()));

        $audit = AuditLog::where('action', 'company.auto_renewal.enabled')->firstOrFail();
        $this->assertStringNotContainsString('ops@acme.de', json_encode($audit->getAttributes()));
        $this->assertStringNotContainsString($address, json_encode($audit->getAttributes()));

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/auto-renewal", ['enabled' => false])
            ->assertOk()->assertJsonPath('data.inbound_address', null);
        $this->assertFalse(app(PasswordlessLoginSettings::class)->autoCodeEnabled($tenant->refresh()));
        $this->assertDatabaseHas('audit_logs', ['action' => 'company.auto_renewal.disabled']);
    }

    public function test_enabling_requires_an_email_and_passes_the_guards(): void
    {
        $this->asSuperAdmin();
        $url = fn (Tenant $t) => "/api/v1/admin/companies/{$t->id}/auto-renewal";
        $body = ['enabled' => true, 'email' => 'ops@acme.de'];

        $this->patchJson($url($this->tenant()), ['enabled' => true])->assertUnprocessable();
        $this->patchJson($url($this->tenant(passwordless: false)), $body)->assertUnprocessable()->assertJsonPath('reason', 'not_eligible');
        $this->patchJson($url($this->tenant(proxy: false)), $body)->assertUnprocessable()->assertJsonPath('reason', 'no_proxy');
        $this->patchJson($url($this->tenant(context: false)), $body)->assertUnprocessable()->assertJsonPath('reason', 'no_prior_session');
    }

    public function test_get_reports_state_email_and_eligibility(): void
    {
        $this->asSuperAdmin();
        $tenant = $this->tenant();
        $url = "/api/v1/admin/companies/{$tenant->id}/auto-renewal";

        $this->getJson($url)->assertOk()->assertExactJson(['data' => [
            'enabled' => false, 'email' => null, 'eligible' => true, 'blocker' => null,
        ]]);

        $this->patchJson($url, ['enabled' => true, 'email' => 'ops@acme.de'])->assertOk();
        $this->getJson($url)->assertOk()->assertJsonPath('data.enabled', true)->assertJsonPath('data.email', 'ops@acme.de');

        $this->getJson("/api/v1/admin/companies/{$this->tenant(proxy: false)->id}/auto-renewal")
            ->assertOk()->assertJsonPath('data.eligible', false)->assertJsonPath('data.blocker', 'no_proxy');
    }

    public function test_a_manager_is_forbidden_and_the_old_manager_routes_are_gone(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = $this->tenant();
        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        $this->patchJson("/api/v1/admin/companies/{$tenant->id}/auto-renewal", ['enabled' => true, 'email' => 'a@b.de'])->assertForbidden();
        $this->getJson("/api/v1/admin/companies/{$tenant->id}/auto-renewal")->assertForbidden();
        $this->getJson('/api/v1/uber-login/settings')->assertNotFound();
        $this->putJson('/api/v1/uber-login/settings', [])->assertNotFound();
        $this->postJson('/api/v1/uber-login/inbound-address/rotate')->assertNotFound();
    }
}
