<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Http\Requests\Api\V1\IngestDriverStatusesRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DispatchDaemonTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
    }

    private function makeSession(string $status = UberFleetSession::STATUS_ACTIVE, array $tenantOverrides = []): UberFleetSession
    {
        $tenant = Tenant::create(array_merge([
            'name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG,
            // An active subscription — the daemon only streams paying companies.
            'status' => 'active', 'activated_at' => now(),
        ], $tenantOverrides));
        app(TenantContext::class)->set($tenant->id);

        return UberFleetSession::create([
            'tenant_id' => $tenant->id,
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'old']],
            'status' => $status,
        ]);
    }

    private function daemon(): self
    {
        return $this->withHeader('X-Dispatch-Secret', self::SECRET);
    }

    public function test_daemon_status_and_roster_syncs_are_recorded_to_the_network_feed(): void
    {
        $session = $this->makeSession();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/statuses", [
            'statuses' => [
                ['driver_uuid' => 'd1', 'status' => 'ON_TRIP'],
                ['driver_uuid' => 'd2', 'status' => 'ONLINE'],
            ],
        ])->assertOk();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/roster", [
            'drivers' => [['uuid' => 'd1'], ['uuid' => 'd2'], ['uuid' => 'd3']],
        ])->assertOk();

        $status = DispatchNetworkLog::where('kind', 'status')->first();
        $this->assertNotNull($status, 'daemon status sync must reach the Network feed');
        $this->assertSame($session->tenant_id, $status->tenant_id);
        $this->assertSame(2, $status->count);

        $roster = DispatchNetworkLog::where('kind', 'roster')->first();
        $this->assertNotNull($roster, 'daemon roster sync must reach the Network feed');
        $this->assertSame(3, $roster->count);
    }

    public function test_a_full_status_batch_of_a_large_fleet_is_accepted(): void
    {
        // GetDriverLiveLocation lists every org driver and the batch isn't chunked:
        // anything the roster endpoint admits must not 422 here.
        $session = $this->makeSession();
        $statuses = array_map(fn (int $i) => ['driver_uuid' => "d{$i}", 'status' => 'OFFLINE'], range(1, 2500));

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/statuses", ['statuses' => $statuses])
            ->assertOk();
        $this->assertSame(RosterSyncService::MAX_DRIVERS, IngestDriverStatusesRequest::MAX_STATUSES);
    }

    public function test_sessions_endpoint_returns_active_sessions_with_cookies(): void
    {
        $session = $this->makeSession();

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()
            ->assertJsonPath('data.0.id', $session->id)
            ->assertJsonPath('data.0.uber_org_uuid', self::ORG)
            ->assertJsonPath('data.0.cookies.0.name', 'sid');
    }

    public function test_proxy_url_reaches_the_daemon_as_plaintext_before_and_after_encryption(): void
    {
        $session = $this->makeSession();
        DB::table('tenants')->where('id', $session->tenant_id)->update(['proxy_url' => 'http://u:p@plain:1']);

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()->assertJsonPath('data.0.proxy_url', 'http://u:p@plain:1');

        // Twice: the rewrite is idempotent (an encrypted row is never re-encrypted).
        $this->artisan('tenants:encrypt-proxy-urls')->assertSuccessful();
        $this->artisan('tenants:encrypt-proxy-urls')->assertSuccessful();
        $stored = (string) DB::table('tenants')->where('id', $session->tenant_id)->value('proxy_url');
        $this->assertStringNotContainsString('plain', $stored);
        $this->assertSame('http://u:p@plain:1', Crypt::decryptString($stored));

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()->assertJsonPath('data.0.proxy_url', 'http://u:p@plain:1');

        // --revert restores plaintext for a rollback to a release without the cast.
        $this->artisan('tenants:encrypt-proxy-urls', ['--revert' => true])->assertSuccessful();
        $this->artisan('tenants:encrypt-proxy-urls', ['--revert' => true])->assertSuccessful();
        $this->assertSame('http://u:p@plain:1', DB::table('tenants')->where('id', $session->tenant_id)->value('proxy_url'));
    }

    public function test_lapsed_subscription_company_is_not_streamed(): void
    {
        // Session is active, but the company's subscription has expired — the
        // daemon must not stream it (no proxy burn / offer processing for a
        // non-paying tenant).
        $this->makeSession(UberFleetSession::STATUS_ACTIVE, [
            'activated_at' => now()->subMonth(),
            'subscription_ends_at' => now()->subDay(),
        ]);

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()
            ->assertJsonPath('data', []);
    }

    public function test_expired_and_relink_sessions_are_excluded(): void
    {
        $this->makeSession(UberFleetSession::STATUS_NEEDS_RELINK);

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_cookie_refresh_persists_rolling_cookies(): void
    {
        $session = $this->makeSession();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'sid', 'value' => 'rotated']],
            'expires_at' => now()->addDays(30)->toIso8601String(),
        ])->assertOk()->assertJsonPath('data.status', 'refreshed');

        $fresh = UberFleetSession::withoutGlobalScopes()->find($session->id);
        $this->assertSame('rotated', $fresh->cookies[0]['value']);
        $this->assertNotNull($fresh->last_event_at);
    }

    public function test_needs_relink_flags_the_session(): void
    {
        $session = $this->makeSession();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/needs-relink")
            ->assertOk()
            ->assertJsonPath('data.status', 'needs_relink');

        $this->assertSame('needs_relink', UberFleetSession::withoutGlobalScopes()->find($session->id)->status);
    }

    public function test_supplier_degraded_keeps_the_session_active(): void
    {
        $session = $this->makeSession();

        // Fleet Hub rejected the daemon's roster/status, but the offer stream is
        // alive — the session must NOT be flagged broken (that dropped live offers).
        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/supplier-degraded")
            ->assertOk()
            ->assertJsonPath('data.status', 'degraded');

        $this->assertSame('active', UberFleetSession::withoutGlobalScopes()->find($session->id)->status);
        $this->assertDatabaseHas('dispatch_network_logs', [
            'tenant_id' => $session->tenant_id,
            'kind' => 'session',
        ]);
    }

    public function test_daemon_endpoints_require_the_secret(): void
    {
        $session = $this->makeSession();

        $this->getJson('/api/v1/internal/dispatch/sessions')->assertUnauthorized();
        $this->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'x', 'value' => 'y']],
        ])->assertUnauthorized();
    }
}
