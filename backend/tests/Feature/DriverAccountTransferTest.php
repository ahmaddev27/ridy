<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Fleet\DriverAccountTransferService;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Http\Resources\DriverResource;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverAccountTransferTest extends TestCase
{
    use RefreshDatabase;

    private const UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $old;

    private Tenant $new;

    protected function setUp(): void
    {
        parent::setUp();
        $this->old = $this->tenant('Y&A', 'org-old');
        $this->new = $this->tenant('Move Now', 'org-new');
        app(TenantContext::class)->set($this->new->id);
    }

    private function tenant(string $name, string $org): Tenant
    {
        return Tenant::create(['name' => $name, 'country' => 'DE', 'uber_org_uuid' => $org, 'status' => 'active', 'activated_at' => now()]);
    }

    private function rosterRow(?string $email = null): array
    {
        return [
            'driverUuid' => ['uuid' => ['uuid' => self::UUID]],
            'name' => ['firstName' => 'Basel', 'lastName' => 'Hamou'],
            'email' => $email,
        ];
    }

    /** The driver row at the old company: dropped from its roster, with an activated account. */
    private function oldRow(array $overrides = []): Driver
    {
        return Driver::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => $this->old->id,
            'name' => 'Basel Hamou',
            'uber_driver_uuid' => self::UUID,
            'roster_removed_at' => now()->subDay(),
            'email' => 'basel@example.com',
            'password' => 'secret-pass',
            'locale' => 'ar',
            'invited_at' => now()->subWeek(),
            'activated_at' => now()->subDays(6),
            'last_login_at' => now()->subHour(),
        ], $overrides));
    }

    private function sync(?string $email = null): array
    {
        return app(RosterSyncService::class)->sync($this->new->id, [$this->rosterRow($email)]);
    }

    private function newRow(): Driver
    {
        return Driver::withoutGlobalScopes()->where('tenant_id', $this->new->id)->firstOrFail();
    }

    public function test_account_devices_and_tokens_move_but_business_records_stay(): void
    {
        $old = $this->oldRow();
        $hash = $old->getRawOriginal('password');
        DeviceToken::withoutGlobalScopes()->create(['tenant_id' => $this->old->id, 'driver_id' => $old->id, 'token' => 'fcm-1', 'platform' => 'android']);
        $old->createToken('app');
        $offer = DispatchOffer::withoutGlobalScopes()->create(['tenant_id' => $this->old->id, 'driver_id' => $old->id, 'driver_uuid' => self::UUID, 'offer_uuid' => 'o-1', 'received_at' => now(), 'raw_payload' => []]);
        DriverMetric::create(['tenant_id' => $this->old->id, 'driver_id' => $old->id, 'period_start' => now()->subWeek(), 'period_end' => now()]);

        $this->sync();

        $new = $this->newRow();
        $this->assertSame('basel@example.com', $new->email);
        $this->assertSame($hash, $new->getRawOriginal('password'));
        $this->assertSame('ar', $new->locale);
        $this->assertNotNull($new->activated_at);
        $this->assertNotNull($new->last_login_at);
        $token = DeviceToken::withoutGlobalScopes()->firstOrFail();
        $this->assertSame([$new->id, $this->new->id], [$token->driver_id, $token->tenant_id]);
        $this->assertSame($new->id, (int) DB::table('personal_access_tokens')->value('tokenable_id'));

        $old->refresh();
        $this->assertNull($old->email);
        $this->assertNull($old->activated_at);
        $this->assertNotNull($old->roster_removed_at);
        $this->assertSame($old->id, $offer->fresh()->driver_id);
        $this->assertSame(1, DriverMetric::withoutGlobalScopes()->where('driver_id', $old->id)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'driver.account_transferred', 'tenant_id' => $this->new->id]);
    }

    public function test_no_transfer_while_the_old_company_still_lists_the_driver(): void
    {
        $this->oldRow(['roster_removed_at' => null]);

        $this->sync();

        $this->assertNull($this->newRow()->activated_at);
        $this->assertSame('basel@example.com', Driver::withoutGlobalScopes()->where('tenant_id', $this->old->id)->value('email'));
    }

    public function test_no_transfer_when_old_row_has_no_account(): void
    {
        $this->oldRow(['email' => null, 'activated_at' => null, 'password' => null]);

        $this->sync();

        $this->assertNull($this->newRow()->activated_at);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'driver.account_transferred']);
    }

    public function test_no_transfer_when_new_row_already_has_an_email(): void
    {
        $old = $this->oldRow();
        $new = Driver::withoutGlobalScopes()->create(['tenant_id' => $this->new->id, 'name' => 'B', 'uber_driver_uuid' => self::UUID, 'email' => 'other@example.com']);

        $this->assertFalse(app(DriverAccountTransferService::class)->transferTo($new));
        $this->assertSame('basel@example.com', $old->fresh()->email);
    }

    public function test_two_qualifying_old_rows_transfer_nothing_and_log(): void
    {
        $third = $this->tenant('Third', 'org-3');
        $first = $this->oldRow();
        $second = $this->oldRow(['tenant_id' => $third->id, 'email' => 'basel2@example.com']);
        Log::spy();

        $this->sync();

        Log::shouldHaveReceived('error')->withArgs(fn ($m) => $m === 'driver.transfer_ambiguous')->once();
        $this->assertNull($this->newRow()->email);
        $this->assertSame('basel@example.com', $first->fresh()->email);
        $this->assertSame('basel2@example.com', $second->fresh()->email);
    }

    public function test_a_transferred_row_is_not_invited(): void
    {
        $this->oldRow();

        $this->sync('uber@example.com');

        $new = $this->newRow();
        $this->assertNull($new->invite_token);
        $this->assertSame('basel@example.com', $new->email);
        $this->assertSame('active', $new->appStatus());
    }

    public function test_a_new_row_with_an_email_is_invited_once(): void
    {
        $this->sync('basel@example.com');

        $first = $this->newRow();
        $this->assertNotNull($first->invited_at);
        $this->assertSame('basel@example.com', $first->email);
        $this->assertTrue(DriverResource::make($first)->resolve()['can_be_invited']);
        $token = $first->invite_token;

        $this->sync('basel@example.com');

        $this->assertSame($token, $this->newRow()->invite_token);
    }

    public function test_a_new_row_without_any_email_is_skipped_and_flagged(): void
    {
        $result = $this->sync(null);

        $this->assertSame(1, $result['created']);
        $row = $this->newRow();
        $this->assertNull($row->invited_at);
        $this->assertFalse(DriverResource::make($row)->resolve()['can_be_invited']);
    }

    public function test_an_invite_that_throws_does_not_break_the_sync(): void
    {
        $this->mock(DriverInvitationService::class)
            ->shouldReceive('invite')->andThrow(ValidationException::withMessages(['email' => 'taken']));

        $result = $this->sync('basel@example.com');

        $this->assertSame(['synced' => 1, 'created' => 1, 'removed' => 0], $result);
        $this->assertNotNull($this->newRow());
    }

    public function test_transfer_fires_when_the_old_tenant_is_expired_or_banned_though_never_marked_removed(): void
    {
        $old = $this->oldRow(['roster_removed_at' => null]);
        $this->old->forceFill(['subscription_ends_at' => now()->subDay()])->save();

        $this->sync();

        $this->assertSame('basel@example.com', $this->newRow()->email);
        $this->assertNull($old->fresh()->email);
    }

    public function test_transfer_fires_when_the_old_tenant_is_banned(): void
    {
        $this->oldRow(['roster_removed_at' => null]);
        $this->old->forceFill(['banned_at' => now()])->save();

        $this->sync();

        $this->assertSame('basel@example.com', $this->newRow()->email);
    }

    public function test_transfer_fires_when_the_old_roster_is_stale(): void
    {
        $this->oldRow(['roster_removed_at' => null, 'roster_synced_at' => now()->subDays(DriverAccountTransferService::STALE_ROSTER_DAYS + 1)]);

        $this->sync();

        $this->assertSame('basel@example.com', $this->newRow()->email);
    }

    public function test_no_transfer_from_a_usable_tenant_with_a_recent_roster(): void
    {
        $this->oldRow(['roster_removed_at' => null, 'roster_synced_at' => now()->subDay()]);

        $this->sync();

        $this->assertNull($this->newRow()->email);
    }

    public function test_a_dead_uber_session_on_a_healthy_tenant_does_not_trigger_a_transfer(): void
    {
        $this->oldRow(['roster_removed_at' => null, 'roster_synced_at' => now()->subHours(6)]);
        UberFleetSession::withoutGlobalScopes()->create(['tenant_id' => $this->old->id, 'uber_org_uuid' => 'org-old', 'status' => 'needs_relink', 'cookies' => []]);

        $this->sync();

        $this->assertNull($this->newRow()->email);
        $this->assertSame('basel@example.com', Driver::withoutGlobalScopes()->where('tenant_id', $this->old->id)->value('email'));
    }

    public function test_a_driver_stranded_by_an_earlier_sync_is_transferred_on_the_next_run(): void
    {
        // The second row already exists from an earlier sync (so it is not newly created).
        $this->sync();
        $this->assertNull($this->newRow()->email);
        $this->oldRow();

        $result = $this->sync();

        $this->assertSame(0, $result['created']);
        $this->assertSame('basel@example.com', $this->newRow()->email);
    }

    public function test_a_row_that_already_has_an_account_is_never_re_examined(): void
    {
        $this->oldRow();
        $this->sync();
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'driver.account_transferred')->count());

        // Even a second qualifying source appearing later cannot touch the working account.
        $third = $this->tenant('Third', 'org-3');
        $this->oldRow(['tenant_id' => $third->id, 'email' => 'basel2@example.com']);
        $this->sync();
        $this->sync();

        $this->assertSame('basel@example.com', $this->newRow()->email);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'driver.account_transferred')->count());
    }

    private function admin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_admin_lists_uuids_shared_by_several_companies(): void
    {
        $old = $this->oldRow(['roster_removed_at' => null]);
        $new = Driver::withoutGlobalScopes()->create(['tenant_id' => $this->new->id, 'name' => 'B', 'uber_driver_uuid' => self::UUID]);
        Driver::withoutGlobalScopes()->create(['tenant_id' => $this->new->id, 'name' => 'Solo', 'uber_driver_uuid' => 'aaaaaaaa-7497-45da-bbe1-27ab08080c10']);
        DeviceToken::withoutGlobalScopes()->create(['tenant_id' => $this->old->id, 'driver_id' => $old->id, 'token' => 't1', 'platform' => 'ios']);
        Sanctum::actingAs($this->admin());

        $rows = collect($this->getJson('/api/v1/admin/driver-conflicts')->assertOk()->json('data'));

        $this->assertEqualsCanonicalizing([$old->id, $new->id], $rows->pluck('driver_id')->all());
        $this->assertSame(1, $rows->firstWhere('driver_id', $old->id)['device_count']);
        $this->assertFalse($rows->firstWhere('driver_id', $old->id)['qualifies_as_source']);
        $this->assertTrue($rows->firstWhere('driver_id', $new->id)['qualifies_as_target']);
    }

    public function test_admin_transfer_reuses_the_service_and_refuses_impossible_states(): void
    {
        $old = $this->oldRow(['roster_removed_at' => null]);
        $new = Driver::withoutGlobalScopes()->create(['tenant_id' => $this->new->id, 'name' => 'B', 'uber_driver_uuid' => self::UUID]);
        Sanctum::actingAs($this->admin());
        $url = '/api/v1/admin/driver-conflicts/transfer';

        $this->postJson($url, ['from_driver_id' => $new->id, 'to_driver_id' => $old->id])
            ->assertStatus(422)->assertJsonPath('code', 'source_has_no_account');
        $this->postJson($url, ['from_driver_id' => $old->id, 'to_driver_id' => $old->id])
            ->assertStatus(422)->assertJsonPath('code', 'same_row');

        $this->postJson($url, ['from_driver_id' => $old->id, 'to_driver_id' => $new->id])->assertOk();
        $this->assertSame('basel@example.com', $new->fresh()->email);
        $this->assertDatabaseHas('audit_logs', ['action' => 'driver.account_transferred']);

        $this->postJson($url, ['from_driver_id' => $old->id, 'to_driver_id' => $new->id])
            ->assertStatus(422)->assertJsonPath('code', 'source_has_no_account');
    }
}
