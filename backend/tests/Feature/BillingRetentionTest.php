<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\Models\Collector;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Issued invoices and cash-ledger rows are accounting records: deleting a
 * company, a collector or a settling payment must never take them along.
 */
class BillingRetentionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    private function invoice(Tenant $tenant, array $attrs = []): SubscriptionPeriod
    {
        return SubscriptionPeriod::create(array_merge([
            'tenant_id' => $tenant->id, 'invoice_no' => 'RE-2026-0042', 'days' => 30, 'amount' => 149,
            'starts_at' => now(), 'ends_at' => now()->addDays(30),
        ], $attrs));
    }

    public function test_a_company_with_invoices_cannot_be_hard_deleted(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $invoice = $this->invoice($tenant, ['paid_at' => now()]);

        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}")
            ->assertStatus(409)->assertJsonPath('message', 'company_has_billing_records');

        $this->assertDatabaseHas('tenants', ['id' => $tenant->id]);
        $this->assertDatabaseHas('subscription_periods', ['id' => $invoice->id, 'invoice_no' => 'RE-2026-0042']);
    }

    public function test_the_database_refuses_to_cascade_invoices_away(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $this->invoice($tenant);

        $this->expectException(QueryException::class);
        $tenant->delete();
    }

    public function test_deleting_a_company_without_billing_leaves_no_orphans(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        app(TenantContext::class)->set($tenant->id);
        $manager = User::create(['name' => 'M', 'email' => 'm@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');
        $manager->createToken('dash');
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'D', 'uber_driver_uuid' => 'u1']);
        $driver->createToken('app');
        DB::table('dispatch_network_logs')->insert(['tenant_id' => $tenant->id, 'kind' => 'roster', 'payload' => '{}', 'created_at' => now()]);
        app(TenantContext::class)->set(null);

        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}")->assertOk();

        $this->assertDatabaseMissing('tenants', ['id' => $tenant->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_type' => Driver::class, 'tokenable_id' => $driver->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_type' => User::class, 'tokenable_id' => $manager->id]);
        $this->assertDatabaseMissing('model_has_roles', ['model_type' => User::class, 'model_id' => $manager->id]);
        $this->assertSame(0, DB::table('dispatch_network_logs')->where('tenant_id', $tenant->id)->count());
    }

    public function test_a_payment_that_settled_an_invoice_cannot_be_deleted(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $collector = Collector::create(['name' => 'Kassierer']);
        $payment = CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $tenant->id, 'amount' => 149, 'paid_on' => now()->toDateString()]);
        $invoice = $this->invoice($tenant, ['paid_at' => now(), 'collector_payment_id' => $payment->id]);

        $this->deleteJson("/api/v1/admin/collector-payments/{$payment->id}")
            ->assertStatus(409)->assertJsonPath('message', 'payment_settles_invoices')
            ->assertJsonPath('invoice_ids.0', $invoice->id);

        $this->assertDatabaseHas('collector_payments', ['id' => $payment->id]);
        $this->assertSame($payment->id, $invoice->fresh()->collector_payment_id);
    }

    public function test_an_unlinked_payment_can_still_be_deleted(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $collector = Collector::create(['name' => 'Kassierer']);
        $payment = CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $tenant->id, 'amount' => 20, 'paid_on' => now()->toDateString()]);

        $this->deleteJson("/api/v1/admin/collector-payments/{$payment->id}")->assertOk();
        $this->assertDatabaseMissing('collector_payments', ['id' => $payment->id]);
    }

    public function test_a_collector_with_cash_payments_cannot_be_deleted(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $reseller = User::create(['name' => 'R', 'email' => 'r@r.de', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $collector = Collector::create(['name' => 'Kassierer', 'user_id' => $reseller->id]);
        CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $tenant->id, 'amount' => 50, 'paid_on' => now()->toDateString()]);

        $this->deleteJson("/api/v1/admin/collectors/{$collector->id}")
            ->assertStatus(422)->assertJsonPath('message', 'collector_has_payments');
        $this->deleteJson("/api/v1/admin/users/{$reseller->id}")
            ->assertStatus(422)->assertJsonPath('message', 'collector_has_payments');

        $this->assertDatabaseHas('collectors', ['id' => $collector->id]);
        $this->assertSame(1, CollectorPayment::where('collector_id', $collector->id)->count());
    }
}
