<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Collections\Models\Collector;
use App\Domain\Collections\Models\CollectorPayment;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BillingReportTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_generate_with_amount_then_activation_creates_a_paid_invoice(): void
    {
        $admin = $this->superAdmin();
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        User::create(['name' => 'O', 'email' => 'o@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 120, 'duration_days' => 30, 'active' => true]);

        // Admin generates the code on a plan, marked already-paid.
        Sanctum::actingAs($admin);
        $code = $this->postJson("/api/v1/admin/companies/{$tenant->id}/activation", ['plan_id' => $plan->id, 'paid' => true])
            ->assertOk()->json('data.code');

        // Company consumes it → the invoice is created, paid, with the plan amount.
        $this->postJson('/api/v1/company/activate', ['email' => 'o@acme.de', 'password' => 'password', 'code' => $code])->assertOk();

        $invoice = SubscriptionPeriod::first();
        $this->assertSame(30, $invoice->days);
        $this->assertSame('120.00', $invoice->amount);
        $this->assertTrue($invoice->isPaid());

        // The invoices list carries the linked code + plan for the Subscriptions page.
        $this->getJson('/api/v1/admin/subscription-invoices')->assertOk()
            ->assertJsonPath('data.0.plan', 'Monthly')
            ->assertJsonPath('data.0.code.code', $code)
            ->assertJsonPath('data.0.code.status', 'activated')
            ->assertJsonPath('data.0.code.paid', true);
    }

    public function test_unpaid_invoice_is_settled_by_linking_a_collector_payment(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $invoice = SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'amount' => 90, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);
        $collector = Collector::create(['name' => 'Ali']);
        $payment = CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $acme->id, 'amount' => 90, 'paid_on' => '2026-08-10']);

        $this->postJson("/api/v1/admin/subscription-invoices/{$invoice->id}/settle", ['collector_payment_id' => $payment->id])
            ->assertOk()->assertJsonPath('data.paid', true);

        $this->assertTrue($invoice->fresh()->isPaid());
        $this->assertSame($payment->id, $invoice->fresh()->collector_payment_id);
    }

    public function test_settle_rejects_a_payment_from_another_company(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $globex = Tenant::create(['name' => 'Globex', 'country' => 'DE']);
        $invoice = SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'amount' => 90, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);
        $collector = Collector::create(['name' => 'Ali']);
        $payment = CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $globex->id, 'amount' => 90, 'paid_on' => '2026-08-10']);

        $this->postJson("/api/v1/admin/subscription-invoices/{$invoice->id}/settle", ['collector_payment_id' => $payment->id])
            ->assertStatus(422);
        $this->assertFalse($invoice->fresh()->isPaid());
    }

    public function test_summary_revenue_counts_only_paid_invoices(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addDays(5)]);
        SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'amount' => 150, 'paid_at' => '2026-08-03', 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);
        SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'amount' => 60, 'paid_at' => null, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);

        $res = $this->getJson('/api/v1/admin/reports/billing-summary')->assertOk();
        $res->assertJsonPath('data.totals.total_revenue', 150)
            ->assertJsonPath('data.totals.outstanding', 60)
            ->assertJsonPath('data.revenue_by_month.0.month', '2026-08')
            ->assertJsonPath('data.expiring.0.name', 'Acme');
    }

    public function test_invoices_list_and_csv_export(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'amount' => 120, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);

        $this->getJson('/api/v1/admin/subscription-invoices')->assertOk()
            ->assertJsonPath('data.0.company_name', 'Acme')
            ->assertJsonPath('data.0.paid', false);

        $csv = $this->get('/api/v1/admin/subscription-invoices/export');
        $csv->assertOk();
        $this->assertStringContainsString('unpaid', $csv->streamedContent());
    }
}
