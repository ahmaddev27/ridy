<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        return Tenant::create(['name' => 'YA Mobility', 'country' => 'DE', 'uber_org_uuid' => self::ORG]);
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
