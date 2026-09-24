<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * EnsureDashboardToken is HTTP-method aware: the extension token may POST its
 * ingest routes but never DELETE /fleet-session (a whole-company purge) nor read
 * /vehicles, even though those share the URI of an allowed route.
 */
class ExtensionTokenMethodScopeTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $this->manager->assignRole('fleet_manager');
    }

    public function test_extension_token_cannot_purge_the_company(): void
    {
        $plain = $this->manager->createToken('ridy-extension', ['fleet-session:write'])->plainTextToken;
        $auth = ['Authorization' => 'Bearer '.$plain];

        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
        ], $auth)->assertCreated();

        $this->app['auth']->forgetGuards();
        $this->deleteJson('/api/v1/fleet-session', [], $auth)->assertForbidden();
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());
    }

    public function test_extension_token_cannot_read_vehicles(): void
    {
        Sanctum::actingAs($this->manager, ['fleet-session:write']);

        $this->getJson('/api/v1/vehicles')->assertForbidden();
        $this->postJson('/api/v1/fleet-session/reconnect')->assertForbidden();
    }

    public function test_full_session_can_still_disconnect(): void
    {
        Sanctum::actingAs($this->manager, ['*']);

        $this->deleteJson('/api/v1/fleet-session')->assertSuccessful();
    }
}
