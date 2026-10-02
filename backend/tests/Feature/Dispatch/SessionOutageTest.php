<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\FleetSessionOutage;
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
 * An outage opens when Uber rejects the session and closes only when the
 * daemon's stream delivers again — a capture of already-dead cookies (the
 * 2026-10-02 Move Now case) must not count as recovery.
 */
class SessionOutageTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private Tenant $tenant;

    private User $manager;

    private UberFleetSession $session;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
        $this->seed(RolePermissionSeeder::class);

        $this->tenant = Tenant::create([
            'name' => 'Move Now', 'country' => 'DE', 'uber_org_uuid' => self::ORG,
            'status' => 'active', 'activated_at' => now(),
        ]);
        $this->manager = User::create([
            'name' => 'M', 'email' => 'm@move.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $this->manager->assignRole('fleet_manager');
        app(TenantContext::class)->set($this->tenant->id);

        $this->session = UberFleetSession::create([
            'tenant_id' => $this->tenant->id,
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => 'old']],
            'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
    }

    private function daemonPost(string $path): void
    {
        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/dispatch/sessions/{$this->session->id}/{$path}")
            ->assertOk();
    }

    private function capture(string $sid, array $extra = []): void
    {
        Sanctum::actingAs($this->manager);
        $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'sid', 'value' => $sid]],
        ] + $extra)->assertCreated();
    }

    private function notificationTypes(): array
    {
        return $this->manager->fresh()->notifications()->pluck('data')->pluck('type')->all();
    }

    public function test_a_rejection_opens_one_outage_and_repeated_flags_do_not_add_more(): void
    {
        $this->daemonPost('needs-relink');
        $this->daemonPost('needs-relink');

        $outage = FleetSessionOutage::sole();
        $this->assertSame('daemon', $outage->cause);
        $this->assertNull($outage->ended_at);
    }

    public function test_a_dead_capture_is_an_attempt_not_a_recovery(): void
    {
        $this->travelTo(now()->setTime(22, 11));
        $this->daemonPost('needs-relink');

        // The extension re-posts cookies that Uber rejects again right away.
        $this->travelTo(now()->addHours(8));
        $this->capture('still-dead', ['auto' => true]);
        $this->daemonPost('needs-relink');

        $outage = FleetSessionOutage::sole();
        $this->assertNull($outage->ended_at, 'only a delivering stream ends an outage');
        $this->assertSame(1, $outage->relink_attempts);
        $this->assertSame(FleetSessionOutage::VIA_AUTO, $outage->recovered_via);
        // No premature "connected" push while the jar was never proven.
        $this->assertNotContains('session_connected', $this->notificationTypes());
    }

    public function test_the_stream_delivering_again_closes_the_outage_and_tells_the_managers(): void
    {
        $this->daemonPost('needs-relink');
        $this->travel(95)->minutes();
        $this->capture('fresh', ['manual' => true]);

        $this->daemonPost('heartbeat');

        $outage = FleetSessionOutage::sole();
        $this->assertNotNull($outage->ended_at);
        $this->assertSame(FleetSessionOutage::VIA_MANUAL, $outage->recovered_via);
        $this->assertSame(95 * 60, $outage->durationSeconds());

        $restored = $this->manager->fresh()->notifications()->get()
            ->first(fn ($n) => $n->data['type'] === 'session_restored');
        $this->assertNotNull($restored);
        $this->assertSame(95, $restored->data['params']['minutes']);
        $this->assertNotContains('session_connected', $this->notificationTypes());
    }

    public function test_a_heartbeat_while_still_broken_does_not_close_the_outage(): void
    {
        $this->daemonPost('needs-relink');
        $this->daemonPost('heartbeat');

        $this->assertNull(FleetSessionOutage::sole()->ended_at);
    }

    public function test_a_first_connect_without_an_outage_still_says_connected(): void
    {
        $this->session->delete();
        $this->capture('new');

        $this->assertSame(0, FleetSessionOutage::count());
        $this->assertContains('session_connected', $this->notificationTypes());
    }

    public function test_the_admin_sees_the_company_outages_with_totals(): void
    {
        FleetSessionOutage::create([
            'tenant_id' => $this->tenant->id, 'uber_fleet_session_id' => $this->session->id,
            'started_at' => now()->subHours(12), 'ended_at' => now()->subMinutes(10),
            'cause' => 'daemon', 'recovered_via' => 'manual', 'relink_attempts' => 3,
        ]);
        FleetSessionOutage::create([
            'tenant_id' => $this->tenant->id, 'uber_fleet_session_id' => $this->session->id,
            'started_at' => now()->subDays(40), 'ended_at' => now()->subDays(40)->addHour(), 'cause' => 'daemon',
        ]);

        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.de', 'password' => Hash::make('password')]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);

        $this->getJson("/api/v1/admin/companies/{$this->tenant->id}/session/outages")
            ->assertOk()
            ->assertJsonPath('data.count', 1)
            ->assertJsonPath('data.total_seconds', 12 * 3600 - 600)
            ->assertJsonPath('data.open', false)
            ->assertJsonPath('data.outages.0.recovered_via', 'manual');

        Sanctum::actingAs($this->manager);
        $this->getJson("/api/v1/admin/companies/{$this->tenant->id}/session/outages")->assertForbidden();
    }
}
