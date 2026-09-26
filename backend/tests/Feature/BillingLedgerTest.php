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

/**
 * Cash-ledger integrity: settling invoices against payments, recording payments,
 * report sums and exports.
 */
class BillingLedgerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Collector $collector;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);

        $this->tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $this->collector = Collector::create(['name' => 'Ali']);
    }

    private function invoice(float $amount, array $attrs = []): SubscriptionPeriod
    {
        return SubscriptionPeriod::create(array_merge([
            'tenant_id' => $this->tenant->id, 'days' => 30, 'amount' => $amount,
            'starts_at' => now(), 'ends_at' => now()->addDays(30),
        ], $attrs));
    }

    private function payment(float $amount): CollectorPayment
    {
        return CollectorPayment::create([
            'collector_id' => $this->collector->id, 'tenant_id' => $this->tenant->id,
            'amount' => $amount, 'paid_on' => '2026-08-10',
        ]);
    }

    private function settle(SubscriptionPeriod $invoice, CollectorPayment $payment, array $extra = [])
    {
        return $this->postJson(
            "/api/v1/admin/subscription-invoices/{$invoice->id}/settle",
            array_merge(['collector_payment_id' => $payment->id], $extra),
        );
    }

    public function test_one_payment_cannot_settle_more_than_its_amount(): void
    {
        $payment = $this->payment(150);
        $first = $this->invoice(149);
        $second = $this->invoice(149);

        $this->settle($first, $payment)->assertOk();
        $this->settle($second, $payment)
            ->assertStatus(422)->assertJsonPath('message', 'payment_insufficient')
            ->assertJsonPath('remaining', 1);

        $this->assertFalse($second->fresh()->isPaid());
    }

    public function test_an_already_paid_invoice_is_only_resettled_explicitly(): void
    {
        $original = $this->payment(90);
        $replacement = $this->payment(90);
        $invoice = $this->invoice(90);
        $this->settle($invoice, $original)->assertOk();

        $this->settle($invoice, $replacement)
            ->assertStatus(409)->assertJsonPath('message', 'invoice_already_paid');
        $this->assertSame($original->id, $invoice->fresh()->collector_payment_id);

        $this->settle($invoice, $replacement, ['resettle' => true])->assertOk();
        $this->assertSame($replacement->id, $invoice->fresh()->collector_payment_id);
    }

    public function test_recording_a_payment_validates_amount_and_date(): void
    {
        $base = ['collector_id' => $this->collector->id, 'tenant_id' => $this->tenant->id];

        $this->postJson('/api/v1/admin/collector-payments', $base + ['amount' => '10.555', 'paid_on' => '2026-08-10'])
            ->assertStatus(422)->assertJsonValidationErrors('amount');
        $this->postJson('/api/v1/admin/collector-payments', $base + ['amount' => 10, 'paid_on' => '0001-01-01'])
            ->assertStatus(422)->assertJsonValidationErrors('paid_on');
        $this->postJson('/api/v1/admin/collector-payments', $base + ['amount' => 10, 'paid_on' => now()->addDays(3)->toDateString()])
            ->assertStatus(422)->assertJsonValidationErrors('paid_on');
    }

    public function test_a_double_submitted_payment_is_booked_once(): void
    {
        $body = ['collector_id' => $this->collector->id, 'tenant_id' => $this->tenant->id, 'amount' => 50, 'paid_on' => now()->toDateString()];

        $first = $this->postJson('/api/v1/admin/collector-payments', $body)->assertCreated()->json('data.id');
        $second = $this->postJson('/api/v1/admin/collector-payments', $body)->assertOk()->json('data.id');

        $this->assertSame($first, $second);
        $this->assertSame(1, CollectorPayment::count());
    }

    public function test_ledger_filters_and_page_size_are_validated_and_clamped(): void
    {
        $this->payment(10);
        $this->payment(20);

        $this->getJson('/api/v1/admin/collector-payments?from=not-a-date')->assertStatus(422);
        $this->getJson('/api/v1/admin/subscription-codes?to=garbage')->assertStatus(422);

        // per_page=-1 used to drop the LIMIT and dump the whole table.
        $this->getJson('/api/v1/admin/collector-payments?per_page=-1')->assertOk()->assertJsonCount(1, 'data');
        $this->invoice(10);
        $this->invoice(20);
        $this->getJson('/api/v1/admin/subscription-invoices?per_page=-1')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_payment_csv_neutralises_formula_notes(): void
    {
        CollectorPayment::create([
            'collector_id' => $this->collector->id, 'tenant_id' => $this->tenant->id,
            'amount' => 5, 'paid_on' => '2026-08-10', 'note' => '=1+1',
        ]);

        $csv = $this->get('/api/v1/admin/collector-payments/export')->assertOk()->streamedContent();

        $this->assertStringContainsString("'=1+1", $csv);
    }

    public function test_invoice_export_prints_the_legal_invoice_number(): void
    {
        $this->invoice(120, ['invoice_no' => 'RE-2026-0042']);

        $csv = $this->get('/api/v1/admin/subscription-invoices/export')->assertOk()->streamedContent();

        $this->assertStringContainsString('RE-2026-0042', $csv);
    }

    public function test_summary_sums_in_cents(): void
    {
        foreach ([0.1, 0.2, 0.3] as $amount) {
            $this->invoice($amount, ['paid_at' => '2026-08-03']);
        }

        $this->getJson('/api/v1/admin/reports/billing-summary')->assertOk()
            ->assertJsonPath('data.totals.total_revenue', 0.6);
    }
}
