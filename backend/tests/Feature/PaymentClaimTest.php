<?php

namespace Tests\Feature;

use App\Domain\Billing\Mail\PaymentClaimResolvedMail;
use App\Domain\Billing\Models\PaymentClaim;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaymentClaimTest extends TestCase
{
    use RefreshDatabase;

    private function owner(Tenant $tenant, string $email = 'owner@acme.de'): User
    {
        return User::create([
            'name' => 'Owner', 'email' => $email,
            'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);
    }

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_a_company_gets_a_stable_reference_on_creation(): void
    {
        $tenant = Tenant::create(['name' => 'Jaber Co', 'country' => 'DE']);

        $this->assertMatchesRegularExpression('/^REIDEY-JAB-\d{4,6}$/', $tenant->fresh()->payment_reference);
    }

    public function test_credential_claim_is_idempotent_while_pending(): void
    {
        $this->seed(RolePermissionSeeder::class); // opening a claim notifies super-admins
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'subscription_ends_at' => CarbonImmutable::now()->subDay()]);
        $this->owner($tenant);

        $first = $this->postJson('/api/v1/company/payment-claim', ['email' => 'owner@acme.de', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.created', true)->json('data.reference');

        // A second submit while one is pending does not open another claim.
        $this->postJson('/api/v1/company/payment-claim', ['email' => 'owner@acme.de', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.created', false)->assertJsonPath('data.reference', $first);

        $this->assertSame(1, PaymentClaim::where('tenant_id', $tenant->id)->where('status', 'pending')->count());
    }

    public function test_admin_accepts_a_claim_issues_a_code_and_emails_it(): void
    {
        Mail::fake();
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $this->owner($tenant);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 50, 'duration_days' => 30, 'active' => true]);
        $claim = PaymentClaim::create(['tenant_id' => $tenant->id, 'reference' => $tenant->ensurePaymentReference(), 'status' => 'pending']);

        $this->postJson("/api/v1/admin/payment-claims/{$claim->id}/resolve", ['status' => 'confirmed', 'plan_id' => $plan->id])
            ->assertOk()->assertJsonPath('data.status', 'confirmed');

        $tenant->refresh();
        $this->assertNotNull($tenant->activation_code);            // a code was issued
        $this->assertSame(1, SubscriptionCode::where('tenant_id', $tenant->id)->count());
        Mail::assertSent(PaymentClaimResolvedMail::class);
    }

    public function test_admin_reject_requires_a_reason_and_emails_it(): void
    {
        Mail::fake();
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $this->owner($tenant);
        $claim = PaymentClaim::create(['tenant_id' => $tenant->id, 'reference' => $tenant->ensurePaymentReference(), 'status' => 'pending']);

        // No reason → rejected by validation.
        $this->postJson("/api/v1/admin/payment-claims/{$claim->id}/resolve", ['status' => 'rejected'])
            ->assertStatus(422);

        $this->postJson("/api/v1/admin/payment-claims/{$claim->id}/resolve", ['status' => 'rejected', 'reason' => 'Transfer not found'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->assertNull($tenant->fresh()->activation_code); // no code on rejection
        Mail::assertSent(PaymentClaimResolvedMail::class);
    }

    public function test_admin_pending_list_shows_the_company_and_reference(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Jaber Co', 'country' => 'DE']);
        PaymentClaim::create(['tenant_id' => $tenant->id, 'reference' => $tenant->ensurePaymentReference(), 'status' => 'pending']);

        $this->getJson('/api/v1/admin/payment-claims')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.company', 'Jaber Co')
            ->assertJsonPath('data.0.reference', $tenant->fresh()->payment_reference);
    }
}
