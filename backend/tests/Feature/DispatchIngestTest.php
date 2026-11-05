<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Jobs\GeocodeOffer;
use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class DispatchIngestTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-dispatch-secret';

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private const DRIVER_UUID = '553decac-7497-45da-bbe1-27ab08080c10';

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(); // no real geocoding calls from the synchronous enrich
        config(['services.dispatch.ingest_secret' => self::SECRET]);
    }

    private function offer(array $overrides = []): array
    {
        return array_merge([
            'offerUUID' => 'e932de1c-6d63-4f37-ad66-4a94625d040c',
            'realOfferUUID' => '95700bce-320e-4600-9ac9-29d0b554e725',
            'partnerUUID' => self::ORG,
            'requestAt' => 1785926943165,
            'riderFirstName' => 'Will',
            'driverInfo' => [
                'driverUUID' => self::DRIVER_UUID,
                'firstName' => 'Mhmoud',
                'lastName' => 'Zedya',
            ],
            'pickupAddress' => 'Bunsen-Kirchhoff-Straße 11, 44139 Dortmund',
            'dropoffAddress' => 'Königswall 15, 44137 Dortmund',
            'formattedUFP' => '€7.41',
            'acceptWindowInSeconds' => 5,
            'offerGeneratedAtMs' => 1785926945285,
        ], $overrides);
    }

    private function tenantWithOrg(): Tenant
    {
        $tenant = Tenant::create(['name' => 'YA Mobility', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
        // Offers now route via an ACTIVE session for the org, not the tenant's
        // stored org column, so the company must be connected.
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);

        return $tenant;
    }

    private function ingestOffers(array $offers, string $secret = self::SECRET)
    {
        return $this->withHeader('X-Dispatch-Secret', $secret)
            ->postJson('/api/v1/internal/dispatch/ingest', ['offers' => $offers, 'seq' => 1785926945]);
    }

    public function test_offer_is_stored_with_full_detail_and_routed_to_linked_driver(): void
    {
        $tenant = $this->tenantWithOrg();
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID]);

        $this->ingestOffers([$this->offer()])
            ->assertOk()
            ->assertJsonPath('data.routed', 1);

        $offer = DispatchOffer::withoutGlobalScopes()->first();
        $this->assertSame($driver->id, $offer->driver_id);
        $this->assertSame('Will', $offer->rider_first_name);
        $this->assertSame('€7.41', $offer->fare_formatted);
        $this->assertSame('Bunsen-Kirchhoff-Straße 11, 44139 Dortmund', $offer->pickup_address);
        $this->assertSame(5, $offer->accept_window_seconds);
        $this->assertNotNull($offer->raw_payload['driverInfo']['driverUUID']);

        // The raw offer is captured for the admin Network tab, exactly as it
        // arrived (pickup UUID intact, kind = offer, attributed to the tenant).
        $log = DispatchNetworkLog::where('kind', 'offer')->first();
        $this->assertNotNull($log, 'daemon ingest must record the offer to the Network feed');
        $this->assertSame($tenant->id, $log->tenant_id);
        $this->assertSame(self::DRIVER_UUID, $log->payload['driverInfo']['driverUUID']);
    }

    public function test_engaged_driver_fix_is_stamped_rounded_on_the_offer(): void
    {
        $this->tenantWithOrg();
        app(TenantContext::class)->set(Tenant::first()->id);
        Driver::create([
            'name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID, 'online_status' => 'ON_TRIP',
            'latitude' => 51.51364217, 'longitude' => 7.46531899, 'heading' => 90.5,
            'location_updated_at' => now()->subMinutes(2),
        ]);

        $this->ingestOffers([$this->offer()])->assertOk();

        $offer = DispatchOffer::withoutGlobalScopes()->first();
        $this->assertSame(51.5136, $offer->receipt_driver_lat);
        $this->assertSame(7.4653, $offer->receipt_driver_lng);
        $this->assertSame('ON_TRIP', $offer->receipt_driver_status);
        $this->assertSame(90.5, $offer->receipt_driver_heading);
        $this->assertNotNull($offer->receipt_driver_fix_at);
        $this->assertNull($offer->chained_after_offer_id);
    }

    public function test_idle_stale_or_unlinked_driver_leaves_the_fix_null(): void
    {
        $this->tenantWithOrg();
        app(TenantContext::class)->set(Tenant::first()->id);
        $driver = Driver::create(['name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID, 'online_status' => 'ONLINE']);

        $this->ingestOffers([$this->offer(['offerUUID' => 'idle-1'])])->assertOk();

        $driver->update(['latitude' => 51.5, 'longitude' => 7.4, 'location_updated_at' => now()->subMinutes(30)]);
        $this->ingestOffers([$this->offer(['offerUUID' => 'stale-1'])])->assertOk();

        $this->ingestOffers([$this->offer(['offerUUID' => 'unlinked-1', 'driverInfo' => ['driverUUID' => 'nobody']])])->assertOk();

        foreach (['idle-1', 'stale-1', 'unlinked-1'] as $uuid) {
            $offer = DispatchOffer::withoutGlobalScopes()->where('offer_uuid', $uuid)->first();
            $this->assertNull($offer->receipt_driver_lat, $uuid);
            $this->assertNull($offer->receipt_driver_fix_at, $uuid);
            $this->assertNull($offer->receipt_driver_status, $uuid);
        }
    }

    public function test_chain_link_and_destination_are_captured_for_a_driver_on_a_ride(): void
    {
        $tenant = $this->tenantWithOrg();
        app(TenantContext::class)->set($tenant->id);
        Driver::create([
            'name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID, 'online_status' => 'ON_TRIP',
            'latitude' => 51.5136, 'longitude' => 7.4653, 'location_updated_at' => now(),
            'trip_waypoints' => [['lat' => 51.50, 'lng' => 7.40], ['lat' => 51.4801, 'lng' => 7.2102]],
        ]);
        $active = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'driver_uuid' => self::DRIVER_UUID, 'offer_uuid' => 'active-1',
            'status' => OfferStatus::Started, 'received_at' => now()->subMinutes(15), 'raw_payload' => [],
            'dropoff_lat' => 51.0, 'dropoff_lng' => 7.0,
        ]);

        $this->ingestOffers([$this->offer()])->assertOk();

        $offer = DispatchOffer::withoutGlobalScopes()->where('offer_uuid', '!=', 'active-1')->first();
        $this->assertSame($active->id, $offer->chained_after_offer_id);
        $this->assertSame('waypoints', $offer->chain_context['dest_source']);
        $this->assertEquals(51.4801, $offer->chain_context['current_dropoff']['lat']);
        $this->assertEquals(7.4653, $offer->chain_context['driver']['lng']);

        Driver::query()->update(['trip_waypoints' => null]);
        $this->ingestOffers([$this->offer(['offerUUID' => 'second-1'])])->assertOk();
        $second = DispatchOffer::withoutGlobalScopes()->where('offer_uuid', 'second-1')->first();
        $this->assertSame('active_offer', $second->chain_context['dest_source']);
        $this->assertEquals(51.0, $second->chain_context['current_dropoff']['lat']);
    }

    public function test_geocoding_is_enqueued_off_the_ingest_hot_path(): void
    {
        Queue::fake();
        // The geo services are down: the bounded pre-push geocode can't finish.
        Http::fake(['*' => Http::response('', 503)]);
        $this->tenantWithOrg();
        app(TenantContext::class)->set(Tenant::first()->id);
        Driver::create(['name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID]);

        // Postcode-less ends: nothing the local PLZ table can place offline.
        $this->ingestOffers([$this->offer(['pickupAddress' => 'Irgendwostraße 1', 'dropoffAddress' => 'Nirgendwoweg 2'])])
            ->assertOk()->assertJsonPath('data.routed', 1);
        $this->assertNull(DispatchOffer::withoutGlobalScopes()->first()->geo_synced_at);

        // An unfinished geocode is handed to GeocodeOffer so a cold-cache address
        // never blocks the batch (or the time-sensitive push).
        Queue::assertPushed(GeocodeOffer::class);
    }

    public function test_no_geocode_job_is_queued_when_the_pre_push_geocode_finished(): void
    {
        Queue::fake();
        $this->tenantWithOrg();
        app(TenantContext::class)->set(Tenant::first()->id);
        Driver::create(['name' => 'Mhmoud Zedya', 'uber_driver_uuid' => self::DRIVER_UUID]);

        $this->ingestOffers([$this->offer()])->assertOk()->assertJsonPath('data.routed', 1);

        $offer = DispatchOffer::withoutGlobalScopes()->first();
        if ($offer->geo_synced_at !== null) {
            Queue::assertNotPushed(GeocodeOffer::class);
        } else {
            Queue::assertPushed(GeocodeOffer::class);
        }
    }

    public function test_offer_for_unlinked_driver_is_stored_without_driver_id(): void
    {
        $this->tenantWithOrg();

        $this->ingestOffers([$this->offer()])
            ->assertOk()
            ->assertJsonPath('data.unlinked_driver', 1);

        $offer = DispatchOffer::withoutGlobalScopes()->first();
        $this->assertNull($offer->driver_id);
        $this->assertSame(self::DRIVER_UUID, $offer->driver_uuid);
    }

    public function test_repeated_offer_uuid_is_deduplicated(): void
    {
        $this->tenantWithOrg();

        $this->ingestOffers([$this->offer()])->assertOk();
        $this->ingestOffers([$this->offer()])->assertOk()->assertJsonPath('data.duplicate', 1);

        $this->assertSame(1, DispatchOffer::withoutGlobalScopes()->count());
    }

    public function test_offer_with_unknown_partner_uuid_is_ignored(): void
    {
        $this->tenantWithOrg();

        $this->ingestOffers([$this->offer(['partnerUUID' => 'unknown-org'])])
            ->assertOk()
            ->assertJsonPath('data.no_tenant', 1);

        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->count());
    }

    public function test_ingest_requires_the_shared_secret(): void
    {
        $this->tenantWithOrg();

        $this->ingestOffers([$this->offer()], 'wrong-secret')->assertUnauthorized();
        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->count());
    }
}
