<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Dispatch\Models\DaemonShard;
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
 * Fleet-session integrity: an unproven org claim can't squat an Uber org, a
 * company holds one org, a stale daemon stream can't overwrite or break a fresh
 * reconnect, and a box that lost a company can't keep writing to it.
 */
class FleetSessionIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private const OTHER_ORG = '0f6d2c55-3a44-4d51-9b8e-2c1f0e7a9b10';

    private const SECRET = 'test-dispatch-secret';

    private Tenant $tenant;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        $this->manager = $this->managerOf($this->tenant, 'm@ya.de');
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function managerOf(Tenant $tenant, string $email): User
    {
        $user = User::create(['name' => 'M', 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function capture(string $org, bool $manual = true, string $sid = 'abc')
    {
        return $this->postJson('/api/v1/fleet-session', [
            'uber_org_uuid' => $org, 'manual' => $manual,
            'cookies' => [['name' => 'sid', 'value' => $sid]],
        ]);
    }

    private function daemon(string $shard = 'main'): self
    {
        return $this->withHeaders(['X-Dispatch-Secret' => self::SECRET, 'X-Shard-Id' => $shard]);
    }

    private function squat(array $overrides = []): UberFleetSession
    {
        $squatter = Tenant::create(['name' => 'Squatter', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);

        return UberFleetSession::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => $squatter->id, 'uber_org_uuid' => self::ORG,
            'cookies' => [['name' => 'junk', 'value' => 'x']], 'status' => UberFleetSession::STATUS_NEEDS_RELINK,
        ], $overrides));
    }

    public function test_org_uuid_must_be_a_uuid(): void
    {
        Sanctum::actingAs($this->manager);

        $this->capture('not-a-uuid')->assertStatus(422);
        $this->capture(str_repeat('a', 300))->assertStatus(422);
    }

    public function test_an_unproven_broken_claim_no_longer_blocks_the_real_owner(): void
    {
        $squat = $this->squat();
        Sanctum::actingAs($this->manager);

        $this->capture(self::ORG)->assertCreated();

        $this->assertNull(UberFleetSession::withoutGlobalScopes()->find($squat->id));
        $this->assertNull(Tenant::find($squat->tenant_id)->uber_org_uuid);
        $this->assertTrue(AuditLog::where('action', 'fleet_session.org_takeover')->exists());
    }

    public function test_a_proven_claim_still_blocks_another_company(): void
    {
        $this->squat(['verified_at' => now(), 'status' => UberFleetSession::STATUS_ACTIVE]);
        Sanctum::actingAs($this->manager);

        $this->capture(self::ORG)->assertStatus(409)->assertJsonPath('message', 'uber_org_already_linked');
    }

    public function test_a_fresh_unproven_active_claim_blocks_until_it_proves_or_breaks(): void
    {
        $this->squat(['status' => UberFleetSession::STATUS_ACTIVE]);
        Sanctum::actingAs($this->manager);

        $this->capture(self::ORG)->assertStatus(409);
    }

    public function test_a_silent_capture_from_a_second_org_is_refused_but_connect_switches(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG)->assertCreated();

        $this->capture(self::OTHER_ORG, manual: false)
            ->assertStatus(202)->assertJsonPath('data.reason', 'org_change_requires_connect');
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->count());

        $this->capture(self::OTHER_ORG, manual: true)->assertCreated();
        $this->assertSame([self::OTHER_ORG], UberFleetSession::withoutGlobalScopes()->pluck('uber_org_uuid')->all());
        $this->assertSame(self::OTHER_ORG, $this->tenant->fresh()->uber_org_uuid);
    }

    public function test_capture_bumps_the_jar_version_only_when_the_cookies_change(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG, sid: 'one')->assertCreated();
        $this->capture(self::ORG, sid: 'one')->assertCreated();
        $this->assertSame(1, UberFleetSession::withoutGlobalScopes()->first()->jar_version);

        $this->capture(self::ORG, sid: 'two')->assertCreated();
        $this->assertSame(2, UberFleetSession::withoutGlobalScopes()->first()->jar_version);
    }

    public function test_a_stale_stream_cannot_overwrite_or_break_a_fresh_jar(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG, sid: 'old')->assertCreated();
        $this->capture(self::ORG, sid: 'fresh')->assertCreated(); // reconnect → version 2
        $session = UberFleetSession::withoutGlobalScopes()->first();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'sid', 'value' => 'old-rotated']], 'jar_version' => 1,
        ])->assertStatus(409);
        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/needs-relink", ['jar_version' => 1])
            ->assertStatus(409);

        $fresh = $session->fresh();
        $this->assertSame('fresh', $fresh->cookies[0]['value']);
        $this->assertSame(UberFleetSession::STATUS_ACTIVE, $fresh->status);

        // The current stream (and daemons that predate versions) still write.
        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'sid', 'value' => 'fresh-rotated']], 'jar_version' => 2,
        ])->assertOk();
        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/cookies", [
            'cookies' => [['name' => 'sid', 'value' => 'legacy']],
        ])->assertOk();
        $this->assertSame('legacy', $session->fresh()->cookies[0]['value']);
    }

    public function test_the_sessions_feed_carries_the_jar_version(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG)->assertCreated();

        $this->daemon()->getJson('/api/v1/internal/dispatch/sessions')
            ->assertOk()->assertJsonPath('data.0.jar_version', 1);
    }

    public function test_a_shard_that_lost_the_company_cannot_write_to_it(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG)->assertCreated();
        $owner = DaemonShard::create(['name' => 'box-a', 'active' => true, 'last_seen_at' => now()]);
        DaemonShard::create(['name' => 'box-b', 'active' => true, 'last_seen_at' => now()]);
        $session = UberFleetSession::withoutGlobalScopes()->first();
        $session->forceFill(['shard_id' => $owner->id])->save();

        $this->daemon('box-b')->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/heartbeat")->assertStatus(409);
        $this->daemon('box-a')->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/heartbeat")->assertOk();
    }

    public function test_a_successful_fleet_hub_read_proves_the_claim(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG)->assertCreated();
        $session = UberFleetSession::withoutGlobalScopes()->first();
        $this->assertNull($session->verified_at);

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/statuses", [
            'statuses' => [['driver_uuid' => 'd1', 'status' => 'ONLINE']],
        ])->assertOk();

        $this->assertNotNull($session->fresh()->verified_at);
    }

    public function test_a_session_on_an_abandoned_org_does_not_sync_the_roster(): void
    {
        $session = UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::OTHER_ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        $this->tenant->forceFill(['uber_org_uuid' => self::ORG])->save();

        $this->daemon()->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/roster", [
            'drivers' => [['driverUuid' => ['uuid' => '553decac-7497-45da-bbe1-27ab08080c10']]],
        ])->assertOk()->assertJsonPath('data.skipped', 'stale_org');
    }

    public function test_capture_and_purge_are_audited(): void
    {
        Sanctum::actingAs($this->manager);
        $this->capture(self::ORG)->assertCreated();
        $this->deleteJson('/api/v1/fleet-session')->assertOk();

        $this->assertTrue(AuditLog::where('action', 'fleet_session.captured')->exists());
        $this->assertTrue(AuditLog::where('action', 'fleet_session.purged')->exists());
    }

    public function test_a_tenantless_super_admin_gets_403_not_500(): void
    {
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.de', 'password' => Hash::make('password')]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
        app(TenantContext::class)->set(null);

        $this->getJson('/api/v1/fleet-session')->assertStatus(403);
        $this->capture(self::ORG)->assertStatus(403);
        $this->postJson('/api/v1/fleet-session/reconnect')->assertStatus(403);
    }
}
