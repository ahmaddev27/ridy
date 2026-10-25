<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverPostalCodeTest extends TestCase
{
    use RefreshDatabase;

    private function actAsDriver(): void
    {
        $tenant = Tenant::create([
            'name' => 'T', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Omar', 'email' => 'omar@x.de',
            'phone' => '+49170', 'employment_type' => 'employee', 'pseudonym_id' => 'p-omar',
        ]);
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(Driver::withoutGlobalScopes()->findOrFail($driver->id), guard: 'driver');
    }

    public function test_a_known_plz_returns_its_authoritative_city(): void
    {
        DB::table('postal_codes')->updateOrInsert(['plz' => '10179'], ['city' => 'Berlin', 'lat' => 52.51, 'lng' => 13.41]);
        $this->actAsDriver();

        $this->getJson('/api/v1/driver/postal-codes/10179')
            ->assertOk()
            ->assertExactJson(['data' => ['plz' => '10179', 'city' => 'Berlin']]);
    }

    public function test_an_unknown_plz_is_a_404_not_a_guess(): void
    {
        DB::table('postal_codes')->where('plz', '00001')->delete();
        $this->actAsDriver();

        $this->getJson('/api/v1/driver/postal-codes/00001')->assertNotFound();
    }

    public function test_a_malformed_plz_never_reaches_the_lookup(): void
    {
        $this->actAsDriver();

        $this->getJson('/api/v1/driver/postal-codes/1017')->assertNotFound();
        $this->getJson('/api/v1/driver/postal-codes/abcde')->assertNotFound();
    }

    public function test_it_needs_a_driver_token(): void
    {
        $this->getJson('/api/v1/driver/postal-codes/10179')->assertUnauthorized();
    }
}
