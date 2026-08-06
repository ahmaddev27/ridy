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

class FleetSessionTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

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

    public function test_manager_captures_session_binding_tenant_to_org(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc'], ['name' => 'csid', 'value' => 'xyz']],
            'expires_at' => now()->addDays(30)->toIso8601String(),
        ])->assertCreated()
            ->assertJsonPath('data.uber_org_uuid', self::ORG)
            ->assertJsonPath('data.status', 'active');

        // Tenant is now bound to its Uber org so offers resolve back to it.
        $this->assertSame(self::ORG, $this->tenant->fresh()->uber_org_uuid);

        // Cookies are stored encrypted and never exposed by the resource.
        $session = UberFleetSession::withoutGlobalScopes()->first();
        $this->assertCount(2, $session->cookies);
        $this->assertArrayNotHasKey('cookies', $this->getJson('/api/v1/fleet-session')->json('data'));
    }

    public function test_recapturing_updates_the_same_session(): void
    {
        Sanctum::actingAs($this->manager);

        $payload = fn (string $v) => [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => $v]],
        ];

        $this->postJson('/api/v1/fleet-session', $payload('old'))->assertCreated();
        $this->postJson('/api/v1/fleet-session', $payload('new'))->assertCreated();

        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());
        $this->assertSame('new', UberFleetSession::withoutGlobalScopes()->first()->cookies[0]['value']);
    }

    public function test_capturing_a_session_notifies_the_managers(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
        ])->assertCreated();

        $this->assertSame(1, $this->manager->fresh()->notifications()->count());
        $this->assertSame('fleet_session_opened', $this->manager->fresh()->notifications()->first()->data['type']);
    }

    public function test_capture_requires_cookies(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', ['uber_org_uuid' => self::ORG, 'cookies' => []])
            ->assertStatus(422);
    }
}
