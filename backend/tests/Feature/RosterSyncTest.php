<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RosterSyncTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.dispatch.ingest_secret' => self::SECRET]);
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => 'org1', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    /** Mirrors the real /api/getDrivers shape, incl. the nested driverUuid. */
    private function driver(array $overrides = []): array
    {
        return array_merge([
            'driverUuid' => ['uuid' => ['uuid' => self::DRIVER_UUID]],
            'name' => ['firstName' => 'Basel', 'lastName' => 'Hamou'],
            'email' => 'basel@example.com',
            'phoneNumber' => ['countryCode' => '+49', 'number' => '17682215606'],
            'pictureUrl' => 'https://cdn.uber.com/pic.jpeg',
            'recognitionRating' => 4.92,
            'tripsInfo' => ['totalCompletedTrips' => 19354],
            'onboardingInfo' => ['status' => 'ONBOARDING_STATUS_ACTIVE'],
        ], $overrides);
    }

    public function test_driver_dropped_from_uber_roster_is_marked_removed_not_deleted(): void
    {
        $other = 'aaaaaaaa-7497-45da-bbe1-27ab08080c10';
        $svc = app(RosterSyncService::class);

        // First sync lists two drivers.
        $svc->sync($this->tenant->id, [$this->driver(), $this->driver(['driverUuid' => ['uuid' => ['uuid' => $other]]])]);
        $this->assertSame(2, Driver::withoutGlobalScopes()->count());

        // Second full sync drops the second driver.
        $result = $svc->sync($this->tenant->id, [$this->driver()]);

        // Nothing is deleted; the dropped driver is only marked removed.
        $this->assertSame(2, Driver::withoutGlobalScopes()->count());
        $this->assertSame(1, $result['removed']);
        $dropped = Driver::withoutGlobalScopes()->where('uber_driver_uuid', $other)->first();
        $this->assertNotNull($dropped->roster_removed_at);
        $kept = Driver::withoutGlobalScopes()->where('uber_driver_uuid', self::DRIVER_UUID)->first();
        $this->assertNull($kept->roster_removed_at);

        // Reappearing in a later sync clears the mark.
        $svc->sync($this->tenant->id, [$this->driver(), $this->driver(['driverUuid' => ['uuid' => ['uuid' => $other]]])]);
        $this->assertNull($dropped->fresh()->roster_removed_at);
    }

    public function test_roster_creates_drivers_with_full_profile(): void
    {
        app(RosterSyncService::class)->sync($this->tenant->id, [$this->driver()]);

        $driver = Driver::withoutGlobalScopes()->first();
        $this->assertSame('Basel Hamou', $driver->name);
        $this->assertSame(self::DRIVER_UUID, $driver->uber_driver_uuid);
        $this->assertSame('+49 17682215606', $driver->phone);
        $this->assertSame('https://cdn.uber.com/pic.jpeg', $driver->uber_picture_url);
        $this->assertSame('4.92', (string) $driver->uber_rating);
        $this->assertSame(19354, $driver->uber_total_trips);
        $this->assertSame('ONBOARDING_STATUS_ACTIVE', $driver->uber_status);
        $this->assertSame('auto', $driver->uber_link_method);
    }

    public function test_resync_updates_in_place_without_duplicates(): void
    {
        $service = app(RosterSyncService::class);
        $service->sync($this->tenant->id, [$this->driver(['recognitionRating' => 4.5])]);
        $service->sync($this->tenant->id, [$this->driver(['recognitionRating' => 4.99])]);

        $this->assertSame(1, Driver::withoutGlobalScopes()->count());
        $this->assertSame('4.99', (string) Driver::withoutGlobalScopes()->first()->uber_rating);
    }

    public function test_roster_backfills_pending_offers(): void
    {
        DispatchOffer::create([
            'tenant_id' => $this->tenant->id,
            'driver_uuid' => self::DRIVER_UUID,
            'offer_uuid' => 'offer-1',
            'received_at' => now(),
            'raw_payload' => [],
        ]);

        app(RosterSyncService::class)->sync($this->tenant->id, [$this->driver()]);

        $driver = Driver::withoutGlobalScopes()->first();
        $this->assertSame($driver->id, DispatchOffer::withoutGlobalScopes()->first()->driver_id);
    }

    public function test_daemon_posts_roster_via_endpoint(): void
    {
        $session = UberFleetSession::create([
            'tenant_id' => $this->tenant->id,
            'uber_org_uuid' => 'org1',
            'cookies' => [['name' => 'sid', 'value' => 'x']],
            'status' => 'active',
        ]);

        $this->withHeader('X-Dispatch-Secret', self::SECRET)
            ->postJson("/api/v1/internal/dispatch/sessions/{$session->id}/roster", ['drivers' => [$this->driver()]])
            ->assertOk()
            ->assertJsonPath('data.created', 1);

        $this->assertSame(1, Driver::withoutGlobalScopes()->count());
    }

    public function test_roster_self_heals_duplicate_drivers_for_one_uuid(): void
    {
        // Two legacy rows share the same uuid (uber_driver_uuid isn't unique).
        $keep = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Old', 'uber_driver_uuid' => self::DRIVER_UUID]);
        $dupe = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Dupe', 'uber_driver_uuid' => self::DRIVER_UUID]);
        DispatchOffer::create([
            'tenant_id' => $this->tenant->id, 'driver_uuid' => self::DRIVER_UUID, 'driver_id' => $dupe->id,
            'offer_uuid' => 'o-dupe', 'received_at' => now(), 'raw_payload' => [],
        ]);

        app(RosterSyncService::class)->sync($this->tenant->id, [$this->driver()]);

        // Collapsed to the single oldest row; the dupe's offer moved to it.
        $this->assertSame(1, Driver::withoutGlobalScopes()->where('uber_driver_uuid', self::DRIVER_UUID)->count());
        $this->assertDatabaseMissing('drivers', ['id' => $dupe->id]);
        $this->assertDatabaseHas('dispatch_offers', ['offer_uuid' => 'o-dupe', 'driver_id' => $keep->id]);
    }

    public function test_dedupe_preserves_the_drivers_login_token(): void
    {
        // Both rows are activated; the driver's live app token sits on the one that
        // will be merged away (the newer duplicate). It must not be orphaned.
        $keep = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Old', 'uber_driver_uuid' => self::DRIVER_UUID, 'activated_at' => now()->subDay()]);
        $dupe = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Dupe', 'uber_driver_uuid' => self::DRIVER_UUID, 'activated_at' => now()]);
        $tokenId = $dupe->createToken('driver-app')->accessToken->id;

        app(RosterSyncService::class)->sync($this->tenant->id, [$this->driver()]);

        $this->assertDatabaseMissing('drivers', ['id' => $dupe->id]);
        // The token now points at the surviving canonical row — the session lives.
        $this->assertDatabaseHas('personal_access_tokens', [
            'id' => $tokenId,
            'tokenable_type' => $keep->getMorphClass(),
            'tokenable_id' => $keep->id,
        ]);
    }

    public function test_manager_roster_refresh_requires_a_connected_session(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        // No stored session yet: the browser "Refresh from Uber" is refused so it
        // can't import whatever Uber account the manager is signed into.
        $this->postJson('/api/v1/drivers/roster', ['drivers' => [$this->driver()]])
            ->assertStatus(409)
            ->assertJsonPath('message', 'not_connected');
        $this->assertSame(0, Driver::withoutGlobalScopes()->count());

        // Once connected (a session exists), the pull is accepted.
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => 'org1', 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        $this->postJson('/api/v1/drivers/roster', ['drivers' => [$this->driver()]])
            ->assertOk()
            ->assertJsonPath('data.created', 1);
    }

    public function test_dedupe_preserves_a_pending_invite(): void
    {
        // Older row has no invite; the duplicate carries a pending invite token.
        Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Old', 'uber_driver_uuid' => self::DRIVER_UUID]);
        $invited = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Invited', 'uber_driver_uuid' => self::DRIVER_UUID,
            'email' => 'inv@example.com', 'invite_token' => 'tok-keepme', 'invited_at' => now(),
        ]);

        app(RosterSyncService::class)->sync($this->tenant->id, [$this->driver()]);

        // Collapsed to one row that still carries the invite token (invite survives).
        $this->assertSame(1, Driver::withoutGlobalScopes()->where('uber_driver_uuid', self::DRIVER_UUID)->count());
        $this->assertDatabaseHas('drivers', ['id' => $invited->id, 'invite_token' => 'tok-keepme']);
    }
}
