<?php

namespace Tests\Feature;

use App\Domain\Billing\InvoiceNumberGenerator;
use App\Domain\Billing\InvoiceRenderer;
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
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression tests for the billing review fixes: the redeem test-code backdoor,
 * atomic code redemption, disabled-company activation, immutable invoices and
 * the invoice number sequence.
 */
class BillingIntegrityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        Mail::fake();
    }

    private function company(string $name = 'Acme', string $status = 'active'): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => $status,
            'activated_at' => now(), 'subscription_ends_at' => now()->addDays(5),
        ]);
    }

    private function manager(Tenant $tenant): User
    {
        $user = User::create([
            'name' => 'Owner', 'email' => 'owner'.$tenant->id.'@acme.de',
            'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function superAdmin(): User
    {
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    private function pendingCode(Tenant $tenant, string $code = '654321', int $days = 30, string $amount = '149.00'): void
    {
        $tenant->forceFill([
            'activation_code' => $code,
            'activation_code_expires_at' => now()->addHour(),
            'activation_days' => $days,
            'activation_amount' => $amount,
            'activation_paid' => true,
        ])->save();
        SubscriptionCode::create([
            'code' => $code, 'tenant_id' => $tenant->id, 'amount' => $amount, 'paid' => true,
            'expires_at' => now()->addHour(),
        ]);
    }

    public function test_redeem_refuses_the_test_code_in_production(): void
    {
        $tenant = $this->company();
        Sanctum::actingAs($this->manager($tenant));
        Plan::create(['name' => 'Monthly', 'price' => 149, 'duration_days' => 30, 'active' => true]);

        config()->set('services.otp_test_code', '424242');
        $this->app->detectEnvironment(fn () => 'production');

        $this->postJson('/api/v1/subscription/redeem', ['code' => '424242'])
            ->assertStatus(422)->assertJsonPath('errors.code.0', 'otp_incorrect');

        $this->assertSame(0, SubscriptionPeriod::count());
    }

    public function test_redeem_locks_out_the_company_after_repeated_wrong_codes(): void
    {
        $tenant = $this->company();
        Sanctum::actingAs($this->manager($tenant));
        $this->pendingCode($tenant, '654321');

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/subscription/redeem', ['code' => '000000'])
                ->assertJsonPath('errors.code.0', 'otp_incorrect');
        }

        // Even the right code is refused while the lockout lasts.
        $this->postJson('/api/v1/subscription/redeem', ['code' => '654321'])
            ->assertStatus(422)->assertJsonPath('errors.code.0', 'otp_too_many');
        $this->assertSame(0, SubscriptionPeriod::count());
    }

    public function test_a_code_redeems_once_even_from_a_stale_tenant_copy(): void
    {
        $tenant = $this->company();
        Sanctum::actingAs($this->manager($tenant));
        $this->pendingCode($tenant, '654321');

        // A parallel request that loaded the tenant before the code was consumed.
        $stale = Tenant::find($tenant->id);

        $this->postJson('/api/v1/subscription/redeem', ['code' => '654321'])->assertOk();

        try {
            app(SubscriptionActivator::class)->apply(
                $stale, (int) $stale->activation_days, $stale->activation_amount,
                (bool) $stale->activation_paid, null, $stale->activation_code,
            );
            $this->fail('A consumed code must not redeem twice.');
        } catch (ValidationException $e) {
            $this->assertSame('otp_incorrect', $e->errors()['code'][0]);
        }

        $this->postJson('/api/v1/subscription/redeem', ['code' => '654321'])
            ->assertStatus(422)->assertJsonPath('errors.code.0', 'otp_incorrect');

        $this->assertSame(1, SubscriptionPeriod::count());
    }

    public function test_public_activation_does_not_re_enable_an_admin_disabled_company(): void
    {
        $tenant = $this->company('Acme', 'disabled');
        $owner = $this->manager($tenant);
        $this->pendingCode($tenant, '654321');

        $this->postJson('/api/v1/company/activate', [
            'email' => $owner->email, 'password' => 'password', 'code' => '654321',
        ])->assertStatus(422)->assertJsonPath('errors.code.0', 'account_disabled');

        $this->assertSame('disabled', $tenant->fresh()->status);
        $this->assertSame(0, SubscriptionPeriod::count());
    }

    public function test_an_issued_invoice_is_frozen_against_later_settings_and_name_changes(): void
    {
        $tenant = $this->company('Acme Fleet GmbH');
        $this->pendingCode($tenant, '654321', 30, '119.00');
        $period = app(SubscriptionActivator::class)->redeemIssuedCode($tenant, '654321');

        $this->assertNotNull($period->issued_at);
        $renderer = app(InvoiceRenderer::class);
        $before = $renderer->html($period->fresh(), InvoiceSettings::current());
        $this->assertStringContainsString('Acme Fleet GmbH', $before);
        $this->assertStringContainsString('100,00', $before); // net of 119.00 @ 19 %

        // Later: VAT posture changes, the company is renamed, the invoice is settled.
        InvoiceSettings::current()->forceFill(['kleinunternehmer' => true, 'issuer_name' => 'New Issuer'])->save();
        $tenant->forceFill(['name' => 'Renamed Co'])->save();
        $period->forceFill(['paid_at' => now()->addDays(20)])->save();

        $after = $renderer->html($period->fresh(), InvoiceSettings::current());
        $this->assertStringContainsString('Acme Fleet GmbH', $after);
        $this->assertStringNotContainsString('Renamed Co', $after);
        $this->assertStringNotContainsString('New Issuer', $after);
        $this->assertStringContainsString('100,00', $after);
        $this->assertStringContainsString(now()->format('d.m.Y'), $after); // issue date unchanged
    }

    public function test_pdf_logo_is_inlined_from_local_storage_and_remote_urls_are_never_fetched(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('invoice-images/logo.png', UploadedFile::fake()->image('logo.png', 20, 20)->get());

        $inline = \Closure::bind(fn (?string $url) => $this->inlineLogo($url), app(InvoiceRenderer::class), InvoiceRenderer::class);

        $this->assertStringStartsWith('data:image/png;base64,', $inline(Storage::disk('public')->url('invoice-images/logo.png')));
        $this->assertNull($inline('http://169.254.169.254/latest/meta-data/logo.png'));
        $this->assertNull($inline('file:///etc/passwd'));
    }

    public function test_invoice_numbers_count_past_9999_and_are_never_reused(): void
    {
        $tenant = $this->company();
        $year = (int) now()->format('Y');
        SubscriptionPeriod::create([
            'tenant_id' => $tenant->id, 'invoice_no' => "RE-{$year}-9999", 'days' => 30,
            'starts_at' => now(), 'ends_at' => now()->addDays(30),
        ]);

        $numbers = app(InvoiceNumberGenerator::class);
        $a = SubscriptionPeriod::create(['tenant_id' => $tenant->id, 'days' => 30, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);
        $this->assertSame("RE-{$year}-10000", $numbers->assign($a, 'RE', $year));

        // Removing the newest row must not hand its number out again.
        $a->delete();
        $b = SubscriptionPeriod::create(['tenant_id' => $tenant->id, 'days' => 30, 'starts_at' => now(), 'ends_at' => now()->addDays(30)]);
        $this->assertSame("RE-{$year}-10001", $numbers->assign($b, 'RE', $year));
    }

    public function test_a_stacked_renewal_is_numbered_by_its_issue_year(): void
    {
        $tenant = $this->company();
        $tenant->forceFill(['subscription_ends_at' => CarbonImmutable::now()->addYear()])->save();
        $this->pendingCode($tenant, '654321');

        $period = app(SubscriptionActivator::class)->redeemIssuedCode($tenant, '654321');

        $this->assertStringStartsWith('RE-'.now()->format('Y').'-', $period->invoice_no);
    }

    public function test_ending_a_subscription_cancels_but_keeps_its_invoices(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = $this->company();
        $running = SubscriptionPeriod::create([
            'tenant_id' => $tenant->id, 'invoice_no' => 'RE-2026-0001', 'days' => 30, 'amount' => 149,
            'paid_at' => now(), 'starts_at' => now()->subDays(10), 'ends_at' => now()->addDays(20),
        ]);
        $queued = SubscriptionPeriod::create([
            'tenant_id' => $tenant->id, 'invoice_no' => 'RE-2026-0002', 'days' => 30, 'amount' => 149,
            'paid_at' => now(), 'starts_at' => now()->addDays(20), 'ends_at' => now()->addDays(50),
        ]);

        $this->deleteJson("/api/v1/admin/companies/{$tenant->id}/subscription")->assertOk();

        $this->assertNotNull($running->fresh()->canceled_at);
        $this->assertNotNull($queued->fresh()->canceled_at);
        $this->assertSame('RE-2026-0002', $queued->fresh()->invoice_no);
        $this->assertSame($running->ends_at->toDateString(), $running->fresh()->ends_at->toDateString());
        $this->assertFalse($tenant->fresh()->isUsable());
    }

    public function test_free_grant_cannot_stack_past_the_timestamp_ceiling(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = $this->company();
        $tenant->forceFill(['subscription_ends_at' => CarbonImmutable::parse('2036-01-01')])->save();

        $this->postJson("/api/v1/admin/companies/{$tenant->id}/free-subscription", ['days' => 3650])
            ->assertStatus(422)->assertJsonPath('errors.days.0', 'subscription_too_long');

        $this->assertSame('2036-01-01', $tenant->fresh()->subscription_ends_at->toDateString());
    }
}
