<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
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
 * The extension-fed offer ingest (POST dispatch/offers/ingest) must accept only
 * the company's OWN Uber org and only when connected — never another account the
 * manager has open in a second tab.
 */
class OfferIngestGuardTest extends TestCase
{
    use RefreshDatabase;

    private const ORG = '7b118561-0f8e-4816-a93f-d6e9c770cfd0';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        // Active company: ingest is refused for a stopped/expired/banned one.
        $this->tenant = Tenant::create(['name' => 'YA', 'country' => 'DE', 'uber_org_uuid' => self::ORG, 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($this->tenant->id);
        $manager = User::create([
            'name' => 'M', 'email' => 'm@ya.de', 'password' => Hash::make('password'), 'tenant_id' => $this->tenant->id,
        ]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);
    }

    private function offer(string $org): array
    {
        return [
            'offerUUID' => 'o-'.$org,
            'driverUUID' => 'd-1',
            'partnerUUID' => $org,
            'pickup' => ['formattedAddress' => 'A'],
            'dropoff' => ['formattedAddress' => 'B'],
        ];
    }

    public function test_ingest_is_refused_without_a_session(): void
    {
        $this->postJson('/api/v1/dispatch/offers/ingest', ['offers' => [$this->offer(self::ORG)]])
            ->assertStatus(409)
            ->assertJsonPath('message', 'not_connected');
        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->count());
    }

    public function test_offer_from_a_foreign_org_is_dropped(): void
    {
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);

        $this->postJson('/api/v1/dispatch/offers/ingest', ['offers' => [$this->offer('some-other-org')]])
            ->assertOk()
            ->assertJsonPath('data.org_mismatch', 1);
        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->count());
    }

    public function test_offer_from_own_org_is_stored(): void
    {
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);

        $this->postJson('/api/v1/dispatch/offers/ingest', ['offers' => [$this->offer(self::ORG)]])
            ->assertOk();
        $this->assertSame(1, DispatchOffer::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());
    }

    public function test_ingest_is_refused_for_an_inactive_company(): void
    {
        UberFleetSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'uber_org_uuid' => self::ORG, 'cookies' => [['name' => 'a', 'value' => 'b']],
        ]);
        // The subscription lapsed: no data may be pulled or accepted any more.
        $this->tenant->update(['subscription_ends_at' => now()->subDay()]);

        $this->postJson('/api/v1/dispatch/offers/ingest', ['offers' => [$this->offer(self::ORG)]])
            ->assertStatus(403)
            ->assertJsonPath('message', 'company_inactive');
        $this->assertSame(0, DispatchOffer::withoutGlobalScopes()->count());
    }
}
