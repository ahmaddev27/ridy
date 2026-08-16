<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OfferExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_manager_can_export_offers_as_csv(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        DispatchOffer::create([
            'tenant_id' => $tenant->id,
            'driver_uuid' => 'd1',
            'driver_first_name' => 'Karim',
            'driver_last_name' => 'Nasser',
            'offer_uuid' => 'o1',
            'rider_first_name' => 'Lena',
            'pickup_address' => 'Horather Straße 183, Wuppertal',
            'dropoff_address' => 'Posener Str. 36, Wuppertal',
            'fare_formatted' => '6,43 €',
            'distance_m' => 5200,
            'received_at' => now(),
            'raw_payload' => ['offerUUID' => 'o1'],
        ]);

        Sanctum::actingAs($user);

        $res = $this->get('/api/v1/dispatch/offers/export')->assertOk();
        $res->assertHeader('content-type', 'text/csv; charset=UTF-8');

        $body = $res->streamedContent();
        $this->assertStringContainsString('Date,Rider,Driver,Pickup,Dropoff', $body);
        $this->assertStringContainsString('Fare (€)', $body);
        $this->assertStringContainsString('€/km,Status', $body);
        // A known offer's row: fare 6.43, distance 5.2 km, €/km 1.24 (Latin/plain numbers).
        $this->assertStringContainsString('Lena', $body);
        $this->assertStringContainsString('Karim Nasser', $body);
        $this->assertStringContainsString('6.43', $body);
        $this->assertStringContainsString('5.20', $body);
        $this->assertStringContainsString('1.24', $body);
    }

    public function test_export_applies_the_same_filters_as_the_list(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $user->assignRole('fleet_manager');
        app(TenantContext::class)->set($tenant->id);

        DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'd1', 'offer_uuid' => 'o1',
            'rider_first_name' => 'Lena', 'received_at' => now(), 'raw_payload' => [],
        ]);
        DispatchOffer::create([
            'tenant_id' => $tenant->id, 'driver_uuid' => 'd2', 'offer_uuid' => 'o2',
            'rider_first_name' => 'Omar', 'received_at' => now(), 'raw_payload' => [],
        ]);

        Sanctum::actingAs($user);

        $body = $this->get('/api/v1/dispatch/offers/export?driver_uuid=d1')->assertOk()->streamedContent();

        $this->assertStringContainsString('Lena', $body);
        $this->assertStringNotContainsString('Omar', $body);
    }
}
