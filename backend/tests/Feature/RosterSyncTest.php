<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => 'org1']);
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
}
