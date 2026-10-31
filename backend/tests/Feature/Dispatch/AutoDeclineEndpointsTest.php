<?php

namespace Tests\Feature\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AutoDeclineEndpointsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE',
            'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->driver = Driver::create([
            'tenant_id' => $this->tenant->id, 'name' => 'Mhmoud', 'uber_driver_uuid' => 'drv-1', 'email' => 'm@ya.de',
        ]);
        Sanctum::actingAs($this->driver, guard: 'driver');
    }

    private function enableFeature(): void
    {
        $this->tenant->forceFill(['settings' => array_merge($this->tenant->settings ?? [], ['auto_decline' => ['enabled' => true]])])->save();
    }

    private function payload(): array
    {
        return [
            'enabled' => true,
            'rules' => [
                'min_fare' => ['enabled' => true, 'value_e2' => 900],
                'reject_cities' => ['enabled' => true, 'cities' => ['Solingen', ' Solingen ', '']],
                'max_pickup_distance' => ['enabled' => false, 'km' => 8],
                'max_trip_distance' => ['enabled' => false, 'km' => 40],
            ],
        ];
    }

    public function test_show_reports_the_feature_flag_and_defaults(): void
    {
        $this->getJson('/api/v1/driver/auto-decline')
            ->assertOk()
            ->assertJsonPath('data.feature_enabled', false)
            ->assertJsonPath('data.enabled', false)
            ->assertJsonPath('data.rules.min_fare.value_e2', 0);
    }

    public function test_update_is_forbidden_while_the_company_feature_is_off(): void
    {
        $this->putJson('/api/v1/driver/auto-decline', $this->payload())->assertForbidden();

        $this->assertNull($this->driver->fresh()->auto_decline);
    }

    public function test_update_saves_normalised_rules_and_the_engine_reads_them(): void
    {
        $this->enableFeature();

        $this->putJson('/api/v1/driver/auto-decline', $this->payload())
            ->assertOk()
            ->assertJsonPath('data.feature_enabled', true)
            ->assertJsonPath('data.rules.reject_cities.cities', ['Solingen']);

        $driver = $this->driver->fresh();
        $this->assertTrue($driver->autoDeclineEnabled());
        $this->assertSame(900, $driver->autoDeclineRules()['min_fare']['value_e2']);
    }

    public function test_money_must_be_integer_cents(): void
    {
        $this->enableFeature();
        $payload = $this->payload();
        $payload['rules']['min_fare']['value_e2'] = 9.5;

        $this->putJson('/api/v1/driver/auto-decline', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('rules.min_fare.value_e2');
    }

    public function test_history_lists_only_this_drivers_landed_early_declines(): void
    {
        $mine = $this->offer('o-1', ['auto_decline_reason' => 'min_fare', 'dispatch_rejected_at' => now()]);
        $this->offer('o-manual', []);
        $this->offer('o-failed', ['auto_decline_reason' => 'min_fare', 'auto_decline_failed_at' => now()]);
        $other = Driver::create(['tenant_id' => $this->tenant->id, 'name' => 'Other', 'uber_driver_uuid' => 'drv-2', 'email' => 'o@ya.de']);
        $this->offer('o-other', ['auto_decline_reason' => 'min_fare', 'driver_id' => $other->id]);

        $this->getJson('/api/v1/driver/auto-decline/history')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id)
            ->assertJsonPath('data.0.auto_decline_reason', 'min_fare');

        $this->getJson('/api/v1/driver/auto-decline/history?reason=reject_cities')
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/driver/auto-decline/history?reason=bogus')->assertUnprocessable();
    }

    /** @param array<string, mixed> $extra */
    private function offer(string $uuid, array $extra): DispatchOffer
    {
        $offer = DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id,
            'driver_id' => $extra['driver_id'] ?? $this->driver->id,
            'driver_uuid' => 'drv-1',
            'offer_uuid' => $uuid,
            'pickup_address' => 'Königswall 15, 44137 Dortmund',
            'fare_amount' => 7.41,
            'received_at' => now(),
            'status' => OfferStatus::Pending,
            'raw_payload' => [],
        ]);
        unset($extra['driver_id']);

        $offer->forceFill($extra)->save();

        return $offer;
    }
}
