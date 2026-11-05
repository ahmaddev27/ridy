<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminForceRelinkTest extends TestCase
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
    }

    private function actAsSuperAdmin(): void
    {
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    public function test_force_relink_marks_needs_relink_and_drops_the_uber_auth_browser(): void
    {
        Http::fake(['*/session/drop' => Http::response(['ok' => true, 'state' => 'not_set_up'])]);
        $this->actAsSuperAdmin();

        $this->postJson("/api/v1/admin/companies/{$this->tenant->id}/session/relink")
            ->assertOk()->assertJsonPath('data.status', UberFleetSession::STATUS_NEEDS_RELINK);

        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/session/drop')
            && $r['company_key'] === (string) $this->tenant->id
            && $r->hasHeader('X-Auth-Secret', 'shh'));
        $this->assertSame(UberFleetSession::STATUS_NEEDS_RELINK, UberFleetSession::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->value('status'));
        $this->assertSame(SessionBrowser::STATE_NOT_SET_UP, SessionBrowser::where('tenant_id', $this->tenant->id)->value('state'));
    }

    public function test_an_uber_auth_failure_does_not_fail_the_relink_and_keeps_the_mirror(): void
    {
        Http::fake(['*/session/drop' => Http::response('boom', 500)]);
        $this->actAsSuperAdmin();

        $this->postJson("/api/v1/admin/companies/{$this->tenant->id}/session/relink")->assertOk();

        $this->assertSame(UberFleetSession::STATUS_NEEDS_RELINK, UberFleetSession::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->value('status'));
        $this->assertSame(SessionBrowser::STATE_ACTIVE, SessionBrowser::where('tenant_id', $this->tenant->id)->value('state'));
    }

    public function test_a_company_manager_cannot_force_a_relink_or_reach_the_drop(): void
    {
        Http::fake();
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        $this->postJson("/api/v1/admin/companies/{$this->tenant->id}/session/relink")->assertForbidden();

        Http::assertNothingSent();
    }

    public function test_cut_session_fully_tears_down_but_keeps_the_passkey(): void
    {
        Http::fake(['*/session/drop' => Http::response(['ok' => true, 'state' => 'not_set_up'])]);
        $this->actAsSuperAdmin();
        DB::table('uber_passkeys')->insert([
            'tenant_id' => $this->tenant->id, 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->deleteJson("/api/v1/admin/companies/{$this->tenant->id}/session")
            ->assertOk()->assertJsonPath('data.deleted', 1);

        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/session/drop') && $r['company_key'] === (string) $this->tenant->id);
        $this->assertSame(0, UberFleetSession::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
        $this->assertSame(SessionBrowser::STATE_NOT_SET_UP, SessionBrowser::where('tenant_id', $this->tenant->id)->value('state'));
        $this->assertTrue($this->tenant->fresh()->isAutolinkBlocked());
        $this->assertSame('active', DB::table('uber_passkeys')->where('tenant_id', $this->tenant->id)->value('status'));
    }
}
