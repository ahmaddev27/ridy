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
        // Active subscription so the daemon streams this company's session.
        $this->tenant = Tenant::create(['name' => 'YA Mobility', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
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

    public function test_capture_is_refused_when_org_is_linked_to_another_company(): void
    {
        // Another company already holds a session for this Uber org.
        $other = Tenant::create(['name' => 'Other', 'country' => 'DE']);
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $other->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);

        Sanctum::actingAs($this->manager);
        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
        ])->assertStatus(409)->assertJsonPath('message', 'uber_org_already_linked');

        // The other company's session is untouched; ours was never created.
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());
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
        $this->assertSame('session_connected', $this->manager->fresh()->notifications()->first()->data['type']);
    }

    public function test_supplier_cookies_are_stored_and_exposed_only_to_the_daemon(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'abc']],
            'supplier_cookies' => [['name' => 'supplier-sid', 'value' => 'sup1'], ['name' => 'csrf', 'value' => 'sup2']],
        ])->assertCreated();

        $session = UberFleetSession::withoutGlobalScopes()->first();
        $this->assertCount(2, $session->supplier_cookies);
        $this->assertSame('supplier-sid', $session->supplier_cookies[0]['name']);

        // The internal daemon endpoint surfaces the supplier jar so it can poll
        // roster/status server-side; the manager-facing resource never does.
        config(['services.dispatch.ingest_secret' => 'test-daemon-secret']);
        $daemon = $this->getJson('/api/v1/internal/dispatch/sessions', ['X-Dispatch-Secret' => 'test-daemon-secret']);
        $daemon->assertOk()->assertJsonPath('data.0.supplier_cookies.0.value', 'sup1');
    }

    public function test_recapture_without_supplier_cookies_keeps_the_stored_jar(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'v1']],
            'supplier_cookies' => [['name' => 'supplier-sid', 'value' => 'keep']],
        ])->assertCreated();

        // A later capture without supplier cookies (e.g. older extension) must not
        // wipe the good jar.
        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'v2']],
        ])->assertCreated();

        $session = UberFleetSession::withoutGlobalScopes()->first();
        $this->assertSame('keep', $session->supplier_cookies[0]['value']);
    }

    public function test_capture_requires_cookies(): void
    {
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/v1/fleet-session', ['uber_org_uuid' => self::ORG, 'cookies' => []])
            ->assertStatus(422);
    }

    public function test_report_broken_flags_an_active_session_for_relink(): void
    {
        $session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'v']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);

        Sanctum::actingAs($this->manager);
        $this->postJson('/api/v1/fleet-session/report-broken')
            ->assertOk()
            ->assertJsonPath('data.status', UberFleetSession::STATUS_NEEDS_RELINK);

        // The session is flagged so the daemon stops using it and the manager,
        // who now sees the "reconnect" banner, is prompted to re-link.
        $this->assertSame(UberFleetSession::STATUS_NEEDS_RELINK, $session->fresh()->status);
    }

    public function test_report_broken_leaves_an_already_broken_session_untouched(): void
    {
        $session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'v']], 'status' => UberFleetSession::STATUS_NEEDS_RELINK,
        ]);

        Sanctum::actingAs($this->manager);
        $this->postJson('/api/v1/fleet-session/report-broken')->assertOk();

        $this->assertSame(UberFleetSession::STATUS_NEEDS_RELINK, $session->fresh()->status);
    }
}
