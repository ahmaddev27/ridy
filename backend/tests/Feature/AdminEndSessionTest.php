<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminEndSessionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.uber_auth.url' => 'http://uber-auth.test:8791', 'services.uber_auth.secret' => 'shh']);
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => '11111111-1111-1111-1111-111111111111',
            'cookies' => [['name' => 'sid', 'value' => 'v']], 'status' => UberFleetSession::STATUS_ACTIVE,
        ]);
        SessionBrowser::create(['tenant_id' => $this->tenant->id, 'state' => SessionBrowser::STATE_ACTIVE, 'last_seen_at' => now()]);
        DispatchOffer::withoutGlobalScopes()->forceCreate([
            'tenant_id' => $this->tenant->id, 'offer_uuid' => 'o-1', 'driver_uuid' => 'd-1', 'received_at' => now(), 'raw_payload' => [], 'status' => 'pending',
        ]);
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    public function test_stop_session_drops_the_browser_stops_tracking_and_keeps_all_data(): void
    {
        Http::fake(['*/session/drop' => Http::response(['ok' => true, 'state' => 'not_set_up'])]);
        DriverStatusIngestor::markDaemonFeeding($this->tenant->id);

        $this->postJson("/api/v1/admin/companies/{$this->tenant->id}/session/relink")->assertOk();

        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/session/drop') && $r['company_key'] === (string) $this->tenant->id);
        $session = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame(UberFleetSession::STATUS_NEEDS_RELINK, $session->status);
        $this->assertNull($session->shard_id);
        $this->assertSame(SessionBrowser::STATE_NOT_SET_UP, SessionBrowser::where('tenant_id', $this->tenant->id)->value('state'));
        $this->assertFalse(DriverStatusIngestor::daemonIsFeeding($this->tenant->id));
        $this->assertTrue($this->tenant->fresh()->isAutolinkBlocked());
        $this->assertSame(1, DispatchOffer::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
    }

    public function test_a_stopped_company_has_no_active_session_for_the_daemon_or_browser(): void
    {
        Http::fake(['*/session/drop' => Http::response(['ok' => true])]);
        $this->postJson("/api/v1/admin/companies/{$this->tenant->id}/session/relink")->assertOk();

        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $this->tenant->id)->where('status', UberFleetSession::STATUS_ACTIVE)->count());
    }
}
