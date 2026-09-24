<?php

namespace Tests\Feature\Platform;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Ops\Models\AlertIncident;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use App\Support\BatchDelete;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class ScheduledCommandsTest extends TestCase
{
    use RefreshDatabase;

    private function usableTenant(string $name = 'Acme'): Tenant
    {
        return Tenant::create(['name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
    }

    public function test_batch_delete_removes_every_matching_row_across_batches(): void
    {
        $old = now()->subHours(72);
        $rows = [];
        for ($i = 0; $i < 25; $i++) {
            $rows[] = ['tenant_id' => null, 'kind' => 'status', 'payload' => '{}', 'created_at' => $old];
        }
        DB::table('dispatch_network_logs')->insert($rows);
        DB::table('dispatch_network_logs')->insert(['tenant_id' => null, 'kind' => 'status', 'payload' => '{}', 'created_at' => now()]);

        $deleted = BatchDelete::run(fn () => DispatchNetworkLog::query()->where('created_at', '<', now()->subHours(48)), 10);

        $this->assertSame(25, $deleted);
        $this->assertSame(1, DispatchNetworkLog::count());
    }

    public function test_network_log_prune_keeps_recent_rows(): void
    {
        DB::table('dispatch_network_logs')->insert([
            ['tenant_id' => null, 'kind' => 'status', 'payload' => '{}', 'created_at' => now()->subHours(49)],
            ['tenant_id' => null, 'kind' => 'status', 'payload' => '{}', 'created_at' => now()->subHour()],
        ]);

        $this->artisan('network-logs:prune')->assertSuccessful();

        $this->assertSame(1, DispatchNetworkLog::count());
    }

    public function test_geocode_prune_drops_old_misses_and_old_hits_only(): void
    {
        DB::table('geocode_cache')->insert([
            ['query' => 'miss-old', 'lat' => null, 'lng' => null, 'created_at' => now()->subYears(2), 'updated_at' => now()->subYears(2)],
            ['query' => 'hit-old', 'lat' => 51.1, 'lng' => 7.1, 'created_at' => now()->subYears(2), 'updated_at' => now()->subYears(2)],
            ['query' => 'hit-new', 'lat' => 51.1, 'lng' => 7.1, 'created_at' => now(), 'updated_at' => now()],
        ]);

        $this->artisan('geocode-cache:prune')->assertSuccessful();

        $this->assertSame(['hit-new'], DB::table('geocode_cache')->pluck('query')->all());
    }

    public function test_offline_lapsed_starts_the_offline_grace(): void
    {
        $expired = Tenant::create([
            'name' => 'Expired', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now()->subYear(), 'subscription_ends_at' => now()->subDay(),
        ]);
        app(TenantContext::class)->set($expired->id);
        $driver = Driver::create(['tenant_id' => $expired->id, 'name' => 'D', 'online_status' => 'ONLINE']);

        $this->artisan('fleet:offline-lapsed')->assertSuccessful();

        $this->assertNotNull($driver->fresh()->went_offline_at);
    }

    public function test_proxy_expiry_notices_are_per_proxy_and_stop_after_expiry(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => 'x', 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        $this->travelTo(CarbonImmutable::parse('2026-09-24 08:00:00'));

        Proxy::create(['label' => 'P1', 'url' => 'http://u:p@1:1', 'capacity' => 5, 'expires_at' => now()->addDays(2)]);
        Proxy::create(['label' => 'P2', 'url' => 'http://u:p@2:1', 'capacity' => 5, 'expires_at' => now()->addDays(3)]);
        Proxy::create(['label' => 'Dead', 'url' => 'http://u:p@3:1', 'capacity' => 5, 'expires_at' => now()->subDays(30)]);

        $this->artisan('notifications:scan')->assertSuccessful();

        $labels = $admin->notifications()->get()->pluck('data.params.label')->sort()->values()->all();
        $this->assertSame(['P1', 'P2'], $labels);

        // Next day, both still unread: no duplicates, and the long-dead proxy stays silent.
        $this->travel(1)->days();
        $this->artisan('notifications:scan')->assertSuccessful();
        $this->assertSame(2, $admin->notifications()->count());
    }

    public function test_check_alerts_resolves_incidents_of_deleted_sessions_and_lapsed_tenants(): void
    {
        $lapsed = Tenant::create([
            'name' => 'Lapsed', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now()->subYear(), 'subscription_ends_at' => now()->subDay(),
        ]);
        $lapsedSession = UberFleetSession::create([
            'tenant_id' => $lapsed->id, 'uber_org_uuid' => 'org-l', 'cookies' => [],
            'status' => UberFleetSession::STATUS_NEEDS_RELINK, 'expires_at' => now()->addDay(),
        ]);
        AlertIncident::create(['key' => "session_relink:{$lapsedSession->id}", 'kind' => 'session_relink', 'title' => 't', 'opened_at' => now()]);
        AlertIncident::create(['key' => 'session_relink:999999', 'kind' => 'session_relink', 'title' => 'gone', 'opened_at' => now()]);

        $live = $this->usableTenant('Live');
        $broken = UberFleetSession::create([
            'tenant_id' => $live->id, 'uber_org_uuid' => 'org-b', 'cookies' => [],
            'status' => UberFleetSession::STATUS_EXPIRED, 'expires_at' => now()->addDay(),
        ]);

        $this->artisan('alerts:check')->assertSuccessful();

        $this->assertNotNull(AlertIncident::where('key', "session_relink:{$lapsedSession->id}")->value('resolved_at'));
        $this->assertNotNull(AlertIncident::where('key', 'session_relink:999999')->value('resolved_at'));
        $this->assertNull(AlertIncident::where('key', "session_relink:{$broken->id}")->value('resolved_at'));
        $this->assertTrue(AlertIncident::where('key', "session_relink:{$broken->id}")->exists());
    }

    public function test_check_sync_logs_the_real_last_sync_time(): void
    {
        $tenant = $this->usableTenant();
        app(TenantContext::class)->set($tenant->id);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'D', 'uber_driver_uuid' => 'u-1', 'status_synced_at' => now()->subHours(3)]);

        Log::spy();
        $this->artisan('fleet:check-sync')->assertSuccessful();

        Log::shouldHaveReceived('warning')->withArgs(fn ($event, $ctx) => $event === 'fleet.sync_stale'
            && $ctx['last_status_sync'] !== null
            && $ctx['stale_for_minutes'] >= 179);
    }

    public function test_driver_email_export_is_scoped_filtered_and_audited(): void
    {
        $tenant = $this->usableTenant();
        app(TenantContext::class)->set($tenant->id);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'A', 'email' => 'active@x.de', 'activated_at' => now()]);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'U', 'uber_email' => 'uber-only@x.de']);
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'R', 'email' => 'removed@x.de', 'activated_at' => now(), 'roster_removed_at' => now()]);

        $this->artisan('drivers:emails')->assertFailed();

        $this->artisan('drivers:emails', ['--tenant' => $tenant->id])
            ->expectsOutput('active@x.de')
            ->assertSuccessful();

        $this->assertSame(1, AuditLog::where('action', 'drivers.emails_exported')->count());
    }
}
