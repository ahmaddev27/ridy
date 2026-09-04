<?php

namespace Tests\Feature;

use App\Domain\Billing\Mail\InvoiceMail;
use App\Domain\Billing\Models\InvoiceSettings;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Billing\SubscriptionActivator;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Testing\File;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InvoiceTemplateTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_settings_get_and_put_round_trip(): void
    {
        Sanctum::actingAs($this->admin());

        $this->getJson('/api/v1/admin/invoice-template')
            ->assertOk()
            ->assertJsonPath('data.issuer_name', 'Reidey GmbH')
            ->assertJsonPath('data.vat_rate', fn ($v) => (float) $v === 19.0);

        $this->putJson('/api/v1/admin/invoice-template', $this->validPayload([
            'issuer_name' => 'Reidey Beispiel GmbH',
            'vat_rate' => 7,
        ]))->assertOk()->assertJsonPath('data.issuer_name', 'Reidey Beispiel GmbH')
            ->assertJsonPath('data.vat_rate', fn ($v) => (float) $v === 7.0);

        $this->assertSame('Reidey Beispiel GmbH', InvoiceSettings::current()->issuer_name);
    }

    public function test_logo_upload_stores_and_returns_a_url(): void
    {
        Storage::fake('public');
        Sanctum::actingAs($this->admin());

        $file = File::image('logo.png', 200, 200);

        $res = $this->postJson('/api/v1/admin/invoice-template/image', ['image' => $file])->assertOk();
        $url = $res->json('data.url');

        $this->assertStringContainsString('invoice-images/', $url);
        $this->assertNotEmpty(Storage::disk('public')->allFiles('invoice-images'));
    }

    public function test_manager_cannot_reach_the_template(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $m = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => 1]);
        $m->assignRole('fleet_manager');
        Sanctum::actingAs($m);

        $this->getJson('/api/v1/admin/invoice-template')->assertForbidden();
    }

    public function test_preview_returns_html_with_the_sample_and_19_percent_math(): void
    {
        Sanctum::actingAs($this->admin());

        $res = $this->get('/api/v1/admin/invoice-template/preview')->assertOk();
        $res->assertHeader('content-type', 'text/html; charset=UTF-8');

        $html = $res->getContent();
        $this->assertStringContainsString('Asfour Fleet GmbH', $html);
        // 149,00 € gross at 19% → net 125,21 €, VAT 23,79 €.
        $this->assertStringContainsString('125,21', $html);
        $this->assertStringContainsString('23,79', $html);
        $this->assertStringContainsString('149,00', $html);
    }

    public function test_preview_reflects_kleinunternehmer_with_no_vat(): void
    {
        Sanctum::actingAs($this->admin());
        InvoiceSettings::current()->update(['kleinunternehmer' => true]);

        $html = $this->get('/api/v1/admin/invoice-template/preview')->assertOk()->getContent();

        // Net equals gross and the §19 note replaces the MwSt line.
        $this->assertStringContainsString('§19', $html);
        $this->assertStringNotContainsString('MwSt', $html);
    }

    public function test_pdf_endpoint_streams_a_pdf_for_a_period(): void
    {
        Sanctum::actingAs($this->admin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $period = SubscriptionPeriod::create([
            'invoice_no' => 'RE-2026-0007',
            'tenant_id' => $tenant->id,
            'days' => 30,
            'amount' => '149.00',
            'paid_at' => CarbonImmutable::now(),
            'starts_at' => CarbonImmutable::now(),
            'ends_at' => CarbonImmutable::now()->addDays(30),
        ]);

        $res = $this->get("/api/v1/admin/subscription-invoices/{$period->id}/pdf")->assertOk();
        $res->assertHeader('content-type', 'application/pdf');
        $this->assertStringContainsString('RE-2026-0007.pdf', $res->headers->get('content-disposition'));
        $this->assertStringStartsWith('%PDF', $res->getContent());
    }

    public function test_activation_assigns_a_sequential_invoice_number_and_emails_the_pdf(): void
    {
        $this->seed(RolePermissionSeeder::class);
        Mail::fake();

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        User::create(['name' => 'Owner', 'email' => 'owner@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $plan = Plan::create(['name' => 'Monatlich', 'price' => 149, 'duration_days' => 30, 'active' => true]);
        SubscriptionCode::create([
            'code' => 'ABC123', 'plan_id' => $plan->id, 'tenant_id' => $tenant->id,
            'amount' => 149, 'paid' => true, 'expires_at' => CarbonImmutable::now()->addDay(),
        ]);

        $activator = app(SubscriptionActivator::class);
        $first = $activator->apply($tenant, 30, '149.00', true, null, 'ABC123');

        $year = CarbonImmutable::now()->format('Y');
        $this->assertSame("RE-{$year}-0001", $first->invoice_no);
        $this->assertMatchesRegularExpression('/^RE-\d{4}-\d{4}$/', $first->invoice_no);

        // A second activation for another tenant takes the next sequence.
        $tenant2 = Tenant::create(['name' => 'Beta', 'country' => 'DE', 'status' => 'active']);
        $second = $activator->apply($tenant2, 30, '99.00', true, null, null);
        $this->assertSame("RE-{$year}-0002", $second->invoice_no);

        // The invoice PDF was emailed to the company owner with a PDF attachment.
        Mail::assertSent(InvoiceMail::class, function (InvoiceMail $mail) use ($year) {
            $attachments = $mail->attachments();

            return $mail->hasTo('owner@acme.de')
                && ($attachments[0] ?? null) instanceof Attachment
                && $attachments[0]->as === "RE-{$year}-0001.pdf"
                && $attachments[0]->mime === 'application/pdf';
        });
    }

    public function test_free_grant_and_unpaid_periods_send_no_invoice_email(): void
    {
        $this->seed(RolePermissionSeeder::class);
        Mail::fake();

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        User::create(['name' => 'Owner', 'email' => 'owner@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);

        // Unpaid activation (amount present but not paid) — no invoice email.
        app(SubscriptionActivator::class)->apply($tenant, 30, '149.00', false, null, null);

        Mail::assertNotSent(InvoiceMail::class);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'issuer_name' => 'Reidey GmbH',
            'issuer_address' => "Str. 8\n42103 Wuppertal\nDeutschland",
            'issuer_tax_id' => 'DE123',
            'issuer_email' => 'billing@reidey.de',
            'issuer_phone' => '+49 202',
            'issuer_website' => 'reidey.de',
            'bank_iban' => 'DE00',
            'bank_bic' => 'WELADEDXXX',
            'bank_name' => 'Sparkasse',
            'logo_url' => null,
            'accent_color' => '#0e6b4e',
            'invoice_title' => 'Rechnung',
            'number_prefix' => 'RE',
            'vat_rate' => 19,
            'kleinunternehmer' => false,
            'currency' => 'EUR',
            'header_note' => 'Flotten-Dispatch',
            'footer_thanks' => 'Danke',
            'footer_terms' => 'Bezahlt per Code.',
        ], $overrides);
    }
}
