<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
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

    private function makeSession(string $status = UberFleetSession::STATUS_ACTIVE): UberFleetSession
    {
        $tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
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

    public function test_sessions_endpoint_returns_active_sessions_with_cookies(): void
    {
        $session = $this->makeSession();

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()
            ->assertJsonPath('data.0.id', $session->id)
            ->assertJsonPath('data.0.uber_org_uuid', self::ORG)
            ->assertJsonPath('data.0.cookies.0.name', 'sid');
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

    public function test_daemon_endpoints_require_the_secret(): void
    {
        $session = $this->makeSession();

        $this->getJson('/api/v1/internal/dispatch/sessions')->assertUnauthorized();
        $this->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'x', 'value' => 'y']],
        ])->assertUnauthorized();
    }
}
