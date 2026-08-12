<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\Models\Collector;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ResellerTest extends TestCase
{
    use RefreshDatabase;

    private function reseller(): array
    {
        $this->seed(RolePermissionSeeder::class);
        $user = User::create(['name' => 'Ali', 'email' => 'ali@r.de', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $user->assignRole('reseller');
        $collector = Collector::create(['name' => 'Ali', 'user_id' => $user->id]);

        return [$user, $collector];
    }

    public function test_reseller_generates_a_code_on_a_plan_and_it_tags_the_invoice(): void
    {
        [$user, $collector] = $this->reseller();
        $plan = Plan::create(['name' => 'Annual', 'price' => 200, 'duration_days' => 365]);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $owner = User::create(['name' => 'O', 'email' => 'o@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);

        Sanctum::actingAs($user);
        $code = $this->postJson('/api/v1/reseller/activation', ['tenant_id' => $tenant->id, 'plan_id' => $plan->id])
            ->assertOk()->assertJsonPath('data.price', 200)->assertJsonPath('data.days', 365)->json('data.code');

        // The company owner consumes the code → invoice created with plan price + reseller tag.
        $this->postJson('/api/v1/company/activate', ['email' => 'o@acme.de', 'password' => 'password', 'code' => $code])->assertOk();

        $invoice = SubscriptionPeriod::first();
        $this->assertSame('200.00', $invoice->amount);
        $this->assertSame(365, $invoice->days);
        $this->assertSame($collector->id, $invoice->sold_by_collector_id);
        $this->assertFalse($invoice->isPaid());
    }

    public function test_reseller_can_search_companies_by_name_or_phone(): void
    {
        [$user] = $this->reseller();
        $acme = Tenant::create(['name' => 'Acme Mobility', 'country' => 'DE']);
        User::create(['name' => 'O', 'email' => 'o@acme.de', 'phone' => '+4915100', 'password' => Hash::make('password'), 'tenant_id' => $acme->id]);

        Sanctum::actingAs($user);
        $this->getJson('/api/v1/reseller/companies/search?q=Acme')->assertOk()->assertJsonPath('data.0.name', 'Acme Mobility');
        $this->getJson('/api/v1/reseller/companies/search?q=915100')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_reseller_cannot_read_tenant_scoped_fleet_data(): void
    {
        [$user] = $this->reseller();
        Sanctum::actingAs($user);

        // No tenant → must be denied, never shown other companies' data.
        $this->getJson('/api/v1/drivers')->assertForbidden();
        $this->getJson('/api/v1/dispatch/offers')->assertForbidden();
        $this->getJson('/api/v1/dashboard/summary')->assertForbidden();
    }

    public function test_reseller_can_still_load_their_session(): void
    {
        [$user] = $this->reseller();
        Sanctum::actingAs($user);

        // /me must work for a tenant-less user, or they can't even sign in.
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email', 'ali@r.de');
    }

    public function test_non_reseller_cannot_generate(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $u = User::create(['name' => 'M', 'email' => 'm@x.de', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $u->assignRole('fleet_manager');
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'Annual', 'price' => 200, 'duration_days' => 365]);

        Sanctum::actingAs($u);
        $this->postJson('/api/v1/reseller/activation', ['tenant_id' => $tenant->id, 'plan_id' => $plan->id])->assertForbidden();
    }
}
