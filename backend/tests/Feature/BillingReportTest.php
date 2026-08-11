<?php

namespace Tests\Feature;

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

    public function test_activating_a_company_generates_an_invoice(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $tenant->forceFill([
            'activation_code' => '654321',
            'activation_code_expires_at' => now()->addMinutes(2),
            'activation_days' => 30,
        ])->save();
        User::create(['name' => 'O', 'email' => 'o@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);

        $this->postJson('/api/v1/company/activate', ['email' => 'o@acme.de', 'password' => 'password', 'code' => '654321'])->assertOk();

        $invoice = SubscriptionPeriod::first();
        $this->assertNotNull($invoice);
        $this->assertSame(30, $invoice->days);
        $this->assertSame($tenant->id, $invoice->tenant_id);
    }

    public function test_summary_reports_revenue_and_expiring(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addDays(5)]);
        $collector = Collector::create(['name' => 'Ali']);
        CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $acme->id, 'amount' => 150, 'paid_on' => '2026-08-03']);
        CollectorPayment::create(['collector_id' => $collector->id, 'tenant_id' => $acme->id, 'amount' => 50, 'paid_on' => '2026-08-09']);

        $res = $this->getJson('/api/v1/admin/reports/billing-summary')->assertOk();
        $res->assertJsonPath('data.totals.total_revenue', 200)
            ->assertJsonPath('data.revenue_by_month.0.month', '2026-08')
            ->assertJsonPath('data.revenue_by_month.0.total', 200)
            ->assertJsonPath('data.expiring.0.name', 'Acme');
    }

    public function test_invoices_list_and_csv_export(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        SubscriptionPeriod::create(['tenant_id' => $acme->id, 'days' => 30, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);

        $this->getJson('/api/v1/admin/subscription-invoices')->assertOk()->assertJsonPath('data.0.company_name', 'Acme');

        $csv = $this->get('/api/v1/admin/subscription-invoices/export');
        $csv->assertOk();
        $this->assertStringContainsString('Acme', $csv->streamedContent());
    }
}
