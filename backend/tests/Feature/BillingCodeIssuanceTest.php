<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\PaymentClaim;
use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\PaymentClaimService;
use App\Domain\Billing\PaymentReferenceGenerator;
use App\Domain\Collections\Models\Collector;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Code issuance paths: the reseller foreign-code guard (now in the shared
 * issuer), reseller company search, and the payment-claim resolve race.
 */
class BillingCodeIssuanceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        Mail::fake();
    }

    private function reseller(string $email = 'ali@r.de'): array
    {
        $user = User::create(['name' => 'Ali', 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => null]);
        $user->assignRole('reseller');

        return [$user, Collector::create(['name' => 'Ali '.$email, 'user_id' => $user->id])];
    }

    private function superAdmin(): User
    {
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_a_reseller_cannot_overwrite_another_resellers_pending_code(): void
    {
        [$first] = $this->reseller('one@r.de');
        [$second] = $this->reseller('two@r.de');
        $plan = Plan::create(['name' => 'Monthly', 'price' => 149, 'duration_days' => 30, 'active' => true]);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        Sanctum::actingAs($first);
        $code = $this->postJson('/api/v1/reseller/activation', ['tenant_id' => $tenant->id, 'plan_id' => $plan->id])
            ->assertOk()->json('data.code');

        Sanctum::actingAs($second);
        $this->postJson('/api/v1/reseller/activation', ['tenant_id' => $tenant->id, 'plan_id' => $plan->id])
            ->assertStatus(422)->assertJsonPath('errors.tenant_id.0', 'code_pending_other_issuer');

        $this->assertSame($code, $tenant->fresh()->activation_code);
        $this->assertSame(1, SubscriptionCode::count());
    }

    public function test_company_search_treats_like_wildcards_literally_and_masks_phones(): void
    {
        [$user] = $this->reseller();
        $tenant = Tenant::create(['name' => 'Acme Mobility', 'country' => 'DE']);
        User::create(['name' => 'O', 'email' => 'o@acme.de', 'phone' => '+491515551234', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        Sanctum::actingAs($user);

        // `__` used to match every company (and leak every owner phone).
        $this->getJson('/api/v1/reseller/companies/search?q=__')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/reseller/companies/search?q=%25%25')->assertOk()->assertJsonCount(0, 'data');

        // A name match shows a masked phone; a phone match shows the phone searched.
        $this->getJson('/api/v1/reseller/companies/search?q=Acme')->assertOk()
            ->assertJsonPath('data.0.name', 'Acme Mobility')
            ->assertJsonPath('data.0.phone', '+49•••••••234');
        $this->getJson('/api/v1/reseller/companies/search?q=1515551234')->assertOk()
            ->assertJsonPath('data.0.phone', '+491515551234');
        // Short digit strings no longer probe the phone column.
        $this->getJson('/api/v1/reseller/companies/search?q=1234')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_a_claim_can_only_be_resolved_once_even_by_a_stale_request(): void
    {
        $admin = $this->superAdmin();
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 149, 'duration_days' => 30, 'active' => true]);
        $claim = app(PaymentClaimService::class)->open($tenant)['claim'];
        $stale = PaymentClaim::find($claim->id); // loaded by a parallel request

        Sanctum::actingAs($admin);
        $this->postJson("/api/v1/admin/payment-claims/{$claim->id}/resolve", ['status' => 'confirmed', 'plan_id' => $plan->id])
            ->assertOk()->assertJsonPath('data.status', 'confirmed');
        $firstCode = $tenant->fresh()->activation_code;

        $issued = false;
        try {
            app(PaymentClaimService::class)->resolve($stale, true, null, $admin, function () use (&$issued) {
                $issued = true;

                return '000000';
            });
            $this->fail('A resolved claim must not resolve twice.');
        } catch (ValidationException $e) {
            $this->assertSame('claim_already_resolved', $e->errors()['status'][0]);
        }

        $this->assertFalse($issued);
        $this->assertSame($firstCode, $tenant->fresh()->activation_code);
        $this->assertSame(1, SubscriptionCode::count());
    }

    public function test_payment_references_count_past_9999(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $code = fn () => SubscriptionCode::create(['code' => '123456', 'tenant_id' => $tenant->id, 'paid' => false, 'expires_at' => now()->addHour()]);
        $code()->forceFill(['payment_ref' => 'ACM-2026-9999'])->save();

        $refs = app(PaymentReferenceGenerator::class);

        $this->assertSame('ACM-2026-10000', $refs->assign($code(), $tenant, 2026));
        $this->assertSame('ACM-2026-10001', $refs->assign($code(), $tenant, 2026));
    }

    public function test_opening_a_claim_twice_returns_the_same_pending_claim(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $service = app(PaymentClaimService::class);

        $first = $service->open($tenant);
        $second = $service->open($tenant);

        $this->assertTrue($first['created']);
        $this->assertFalse($second['created']);
        $this->assertSame($first['claim']->id, $second['claim']->id);
    }
}
