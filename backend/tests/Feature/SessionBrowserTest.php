<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SessionBrowserTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
    }

    private function tenant(array $overrides = []): Tenant
    {
        return Tenant::create(array_merge(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()], $overrides));
    }

    private function service(): self
    {
        return $this->withHeader('X-Dispatch-Secret', self::SECRET);
    }

    private function jar(string $value = 'v1'): array
    {
        return [['name' => 'sid', 'value' => $value]];
    }

    public function test_internal_endpoints_require_the_secret(): void
    {
        $tenant = $this->tenant();

        $this->postJson('/api/v1/internal/session-browser/status', ['browsers' => []])->assertUnauthorized();
        $this->postJson("/api/v1/internal/session-browser/{$tenant->id}/capture", [])->assertUnauthorized();
    }

    public function test_status_creates_then_updates_a_row_and_stamps_last_seen(): void
    {
        $tenant = $this->tenant(['uber_org_uuid' => self::ORG]);
        $this->travelTo(CarbonImmutable::parse('2026-10-28 10:00:00'));

        $this->service()->postJson('/api/v1/internal/session-browser/status', ['browsers' => [
            ['tenant_id' => $tenant->id, 'state' => 'active', 'hard_reauth_count' => 2, 'last_login_at' => '2026-10-28T08:00:00Z'],
            ['tenant_id' => 999999, 'state' => 'active'],
        ]])->assertOk()->assertJsonPath('data.updated', 1);

        $row = SessionBrowser::where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame('active', $row->state);
        $this->assertSame(2, $row->hard_reauth_count);
        $this->assertTrue($row->isLive());

        $this->travelTo(CarbonImmutable::parse('2026-10-28 10:05:00'));
        $this->assertFalse($row->fresh()->isLive());

        // Resolve by org uuid this time; fields not sent keep their value.
        $this->service()->postJson('/api/v1/internal/session-browser/status', ['browsers' => [
            ['uber_org_uuid' => self::ORG, 'state' => 'needs_otp', 'consecutive_errors' => 3],
        ]])->assertOk()->assertJsonPath('data.updated', 1);

        $this->assertSame(1, SessionBrowser::count());
        $row = $row->fresh();
        $this->assertSame('needs_otp', $row->state);
        $this->assertSame(2, $row->hard_reauth_count);
        $this->assertSame(3, $row->consecutive_errors);
        $this->assertTrue($row->isLive());
    }

    public function test_status_rejects_an_unknown_state(): void
    {
        $tenant = $this->tenant();

        $this->service()->postJson('/api/v1/internal/session-browser/status', ['browsers' => [
            ['tenant_id' => $tenant->id, 'state' => 'bogus'],
        ]])->assertStatus(422);
    }

    public function test_capture_stores_the_session_and_bumps_the_jar_version(): void
    {
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/capture";

        $this->service()->postJson($url, ['uber_org_uuid' => self::ORG, 'cookies' => $this->jar('a')])
            ->assertCreated()
            ->assertJsonPath('data.uber_org_uuid', self::ORG)
            ->assertJsonPath('data.status', UberFleetSession::STATUS_ACTIVE)
            ->assertJsonMissingPath('data.cookies');

        $session = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame(1, (int) $session->jar_version);
        $this->assertSame(UberFleetSession::STATUS_ACTIVE, $session->status);
        $this->assertNotNull(SessionBrowser::where('tenant_id', $tenant->id)->value('last_capture_at'));

        $this->service()->postJson($url, ['uber_org_uuid' => self::ORG, 'cookies' => $this->jar('b')])->assertCreated();
        $this->assertSame(2, (int) $session->fresh()->jar_version);
    }

    public function test_capture_requires_a_non_empty_cookie_jar(): void
    {
        $tenant = $this->tenant();

        $this->service()->postJson("/api/v1/internal/session-browser/{$tenant->id}/capture", [
            'uber_org_uuid' => self::ORG, 'cookies' => [],
        ])->assertStatus(422);
    }

    public function test_capture_respects_autolink_blocked(): void
    {
        $tenant = $this->tenant();
        $tenant->blockAutolink();

        $this->service()->postJson("/api/v1/internal/session-browser/{$tenant->id}/capture", [
            'uber_org_uuid' => self::ORG, 'cookies' => $this->jar(),
        ])->assertStatus(202)->assertJsonPath('data.reason', 'autolink_blocked');

        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()->count());
    }

    public function test_capture_refuses_a_different_org_without_an_explicit_connect(): void
    {
        $tenant = $this->tenant();
        $url = "/api/v1/internal/session-browser/{$tenant->id}/capture";
        $this->service()->postJson($url, ['uber_org_uuid' => self::ORG, 'cookies' => $this->jar()])->assertCreated();

        $this->service()->postJson($url, [
            'uber_org_uuid' => '11111111-2222-3333-4444-555555555555', 'cookies' => $this->jar('x'),
        ])->assertStatus(202)->assertJsonPath('data.reason', 'org_change_requires_connect');

        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count());
    }

    public function test_wanted_lists_active_connected_companies_with_cookies_and_skips_lapsed(): void
    {
        $active = $this->tenant();
        $this->service()->postJson("/api/v1/internal/session-browser/{$active->id}/capture", [
            'uber_org_uuid' => self::ORG,
            'cookies' => $this->jar('a'),
            'supplier_cookies' => [['name' => 'sp-jwt-session', 'value' => 'x']],
        ])->assertCreated();

        // A lapsed company with an active session row must NOT be wanted.
        $lapsed = $this->tenant(['subscription_ends_at' => now()->subDay()]);
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $lapsed->id,
            'uber_org_uuid' => 'e91f8d43-0000-4000-8000-000000000000',
            'cookies' => $this->jar('b'),
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);

        $this->service()->getJson('/api/v1/internal/session-browser/wanted')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.tenant_id', $active->id)
            ->assertJsonPath('data.0.uber_org_uuid', self::ORG)
            ->assertJsonPath('data.0.cookies.0.name', 'sid');
    }

    public function test_wanted_requires_the_secret(): void
    {
        $this->getJson('/api/v1/internal/session-browser/wanted')->assertUnauthorized();
    }

    public function test_admin_reads_the_session_browser_state(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        $tenant = $this->tenant();
        Sanctum::actingAs($admin);

        $this->getJson("/api/v1/admin/companies/{$tenant->id}/session-browser")
            ->assertOk()->assertExactJson(['data' => ['state' => 'not_set_up']]);

        SessionBrowser::create(['tenant_id' => $tenant->id, 'state' => 'active', 'last_seen_at' => now(), 'hard_reauth_count' => 1]);

        $this->getJson("/api/v1/admin/companies/{$tenant->id}/session-browser")
            ->assertOk()
            ->assertJsonPath('data.state', 'active')
            ->assertJsonPath('data.is_live', true)
            ->assertJsonPath('data.hard_reauth_count', 1);
    }

    public function test_admin_endpoint_is_forbidden_for_a_manager(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = $this->tenant();
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        Sanctum::actingAs($manager);
        $this->getJson("/api/v1/admin/companies/{$tenant->id}/session-browser")->assertForbidden();
    }
}
