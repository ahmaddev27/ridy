<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The browser-extension token is scoped to `fleet-session:write` and must be
 * confined to the ingest / session-capture routes — never the dashboard API.
 */
class ExtensionTokenScopeTest extends TestCase
{
    use RefreshDatabase;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE']);
        $this->manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de',
            'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        app(TenantContext::class)->set($tenant->id);
    }

    public function test_extension_token_is_rejected_on_dashboard_routes(): void
    {
        Sanctum::actingAs($this->manager, ['fleet-session:write']);

        $this->getJson('/api/v1/drivers')->assertForbidden();
        $this->getJson('/api/v1/dispatch/offers')->assertForbidden();
        $this->getJson('/api/v1/audit-logs')->assertForbidden();
    }

    public function test_extension_token_is_allowed_on_session_routes(): void
    {
        Sanctum::actingAs($this->manager, ['fleet-session:write']);

        // Reaches the controller (no session yet -> its own response), not a 403.
        $this->getJson('/api/v1/fleet-session')->assertStatus(200);
    }

    public function test_full_session_still_reaches_the_dashboard(): void
    {
        // A normal dashboard login carries all abilities.
        Sanctum::actingAs($this->manager, ['*']);

        $this->getJson('/api/v1/drivers')->assertOk();
    }
}
