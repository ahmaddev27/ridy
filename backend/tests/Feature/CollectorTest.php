<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Collections\Models\Collector;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CollectorTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create([
            'name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null,
        ]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_non_super_admin_is_forbidden(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        Sanctum::actingAs($manager);
        $this->getJson('/api/v1/admin/collectors')->assertForbidden();
    }

    public function test_admin_creates_a_collector(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/collectors', ['name' => 'Ali', 'phone' => '+4915100', 'address' => 'Berlin'])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Ali')
            ->assertJsonPath('data.total_collected', 0);

        $this->assertDatabaseHas('collectors', ['name' => 'Ali', 'phone' => '+4915100']);
    }

    public function test_index_reports_total_collected_from_issued_paid_codes(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $collector = Collector::create(['name' => 'Ali']);
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'M', 'price' => 1, 'duration_days' => 30]);

        SubscriptionCode::create(['code' => '111111', 'plan_id' => $plan->id, 'tenant_id' => $acme->id, 'collector_id' => $collector->id, 'amount' => 100.50, 'paid' => true, 'expires_at' => now()->addMinutes(10)]);
        SubscriptionCode::create(['code' => '222222', 'plan_id' => $plan->id, 'tenant_id' => $acme->id, 'collector_id' => $collector->id, 'amount' => 200, 'paid' => true, 'expires_at' => now()->addMinutes(10)]);
        // An unpaid code must not count toward the collected total.
        SubscriptionCode::create(['code' => '333333', 'plan_id' => $plan->id, 'tenant_id' => $acme->id, 'collector_id' => $collector->id, 'amount' => 50, 'paid' => false, 'expires_at' => now()->addMinutes(10)]);

        $row = collect($this->getJson('/api/v1/admin/collectors')->assertOk()->json('data'))->firstWhere('name', 'Ali');
        $this->assertSame(300.5, $row['total_collected']);
        $this->assertSame(2, $row['payments_count']);
    }

    public function test_creating_a_collector_with_login_makes_a_reseller_user(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/collectors', ['name' => 'Ali', 'email' => 'ali@reseller.de', 'password' => 'secret123'])
            ->assertCreated()
            ->assertJsonPath('data.has_login', true)
            ->assertJsonPath('data.email', 'ali@reseller.de');

        $collector = Collector::first();
        $this->assertNotNull($collector->user_id);
        $this->assertTrue($collector->user->hasRole('reseller'));
    }

    public function test_reseller_can_sign_in_with_the_created_login(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $this->postJson('/api/v1/admin/collectors', ['name' => 'Ali', 'email' => 'ali@reseller.de', 'password' => 'secret123'])->assertCreated();

        // The reseller can authenticate with those credentials.
        $this->postJson('/api/v1/login', ['email' => 'ali@reseller.de', 'password' => 'secret123'])->assertOk();
    }

    public function test_deleting_a_collector_with_issued_codes_is_blocked(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $collector = Collector::create(['name' => 'Ali']);
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        SubscriptionCode::create(['code' => '111111', 'tenant_id' => $acme->id, 'collector_id' => $collector->id, 'amount' => 50, 'paid' => true, 'expires_at' => now()->addMinutes(10)]);

        $this->deleteJson("/api/v1/admin/collectors/{$collector->id}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'collector_has_payments');

        $this->assertDatabaseHas('collectors', ['id' => $collector->id]);
    }

    public function test_records_a_payment_and_filters_the_ledger_by_company(): void
    {
        $admin = $this->superAdmin();
        Sanctum::actingAs($admin);
        $collector = Collector::create(['name' => 'Ali']);
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $globex = Tenant::create(['name' => 'Globex', 'country' => 'DE']);

        $this->postJson('/api/v1/admin/collector-payments', [
            'collector_id' => $collector->id, 'tenant_id' => $acme->id, 'amount' => 120, 'paid_on' => '2026-08-10', 'note' => 'August',
        ])->assertCreated()->assertJsonPath('data.company_name', 'Acme');

        CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $globex->id, 'amount' => 80, 'paid_on' => '2026-08-11']);

        // The payment stores who recorded it.
        $this->assertDatabaseHas('collector_payments', ['tenant_id' => $acme->id, 'created_by' => $admin->id]);

        // Per-company statement: filter by tenant_id.
        $res = $this->getJson("/api/v1/admin/collector-payments?tenant_id={$acme->id}")->assertOk();
        $res->assertJsonCount(1, 'data')->assertJsonPath('meta.sum', 120);
    }

    public function test_exports_filtered_payments_as_csv(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $collector = Collector::create(['name' => 'Ali']);
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $acme->id, 'amount' => 120, 'paid_on' => '2026-08-10']);

        $res = $this->get('/api/v1/admin/collector-payments/export');
        $res->assertOk();
        $this->assertStringContainsString('text/csv', $res->headers->get('Content-Type'));
        $this->assertStringContainsString('Acme', $res->streamedContent());
    }
}
