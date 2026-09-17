<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Domain\Billing\Models\SubscriptionCode;
use App\Domain\Billing\PaymentReferenceGenerator;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaymentReferenceTest extends TestCase
{
    use RefreshDatabase;

    private function newCode(Tenant $tenant): SubscriptionCode
    {
        return SubscriptionCode::create([
            'code' => (string) random_int(100000, 999999),
            'tenant_id' => $tenant->id,
            'amount' => 50,
            'paid' => false,
            'expires_at' => now()->addMinutes(10),
        ]);
    }

    public function test_reference_uses_the_company_prefix_year_and_padded_sequence(): void
    {
        $tenant = Tenant::create(['name' => 'Dinari Transport', 'country' => 'DE']);
        $generator = app(PaymentReferenceGenerator::class);

        $first = $generator->assign($this->newCode($tenant), $tenant, 2026);
        $second = $generator->assign($this->newCode($tenant), $tenant, 2026);

        $this->assertSame('DIN-2026-0001', $first);
        $this->assertSame('DIN-2026-0002', $second); // sequence increments per prefix+year
    }

    public function test_sequences_are_independent_per_prefix_and_reset_per_year(): void
    {
        $dinari = Tenant::create(['name' => 'Dinari', 'country' => 'DE']);
        $acme = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $generator = app(PaymentReferenceGenerator::class);

        $this->assertSame('DIN-2026-0001', $generator->assign($this->newCode($dinari), $dinari, 2026));
        $this->assertSame('ACM-2026-0001', $generator->assign($this->newCode($acme), $acme, 2026));
        $this->assertSame('DIN-2027-0001', $generator->assign($this->newCode($dinari), $dinari, 2027));
    }

    public function test_prefix_transliterates_an_arabic_name_to_latin(): void
    {
        $generator = app(PaymentReferenceGenerator::class);

        // Str::ascii transliterates Arabic script → a meaningful Latin prefix.
        $arabic = Tenant::create(['name' => 'شركة النقل', 'country' => 'DE']);
        $this->assertStringStartsWith('SHR-2026-', $generator->assign($this->newCode($arabic), $arabic, 2026));
    }

    public function test_prefix_falls_back_or_pads_when_there_are_too_few_latin_letters(): void
    {
        $generator = app(PaymentReferenceGenerator::class);

        $letterless = Tenant::create(['name' => '123 !!!', 'country' => 'DE']); // no letters at all → generic
        $this->assertStringStartsWith('CMP-2026-', $generator->assign($this->newCode($letterless), $letterless, 2026));

        $short = Tenant::create(['name' => 'A1', 'country' => 'DE']); // one Latin letter → padded
        $this->assertStringStartsWith('AXX-2026-', $generator->assign($this->newCode($short), $short, 2026));
    }

    public function test_admin_generate_returns_a_payment_reference(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        $tenant = Tenant::create(['name' => 'Dinari', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 50, 'duration_days' => 30, 'active' => true]);

        Sanctum::actingAs($admin);
        $ref = $this->postJson("/api/v1/admin/companies/{$tenant->id}/activation", ['plan_id' => $plan->id])
            ->assertOk()
            ->assertJsonPath('data.payment_ref', 'DIN-2026-0001')
            ->json('data.payment_ref');

        $this->assertSame($ref, SubscriptionCode::first()->payment_ref);
    }

    public function test_admin_generate_records_the_selected_payment_method(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        $tenant = Tenant::create(['name' => 'Dinari', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 50, 'duration_days' => 30, 'active' => true]);

        Sanctum::actingAs($admin);
        $this->postJson("/api/v1/admin/companies/{$tenant->id}/activation", ['plan_id' => $plan->id, 'payment_method' => 'bank'])
            ->assertOk()
            ->assertJsonPath('data.payment_method', 'bank');

        $this->assertSame('bank', SubscriptionCode::first()->payment_method);
    }

    public function test_admin_generate_rejects_an_unknown_payment_method(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        $tenant = Tenant::create(['name' => 'Dinari', 'country' => 'DE']);
        $plan = Plan::create(['name' => 'Monthly', 'price' => 50, 'duration_days' => 30, 'active' => true]);

        Sanctum::actingAs($admin);
        $this->postJson("/api/v1/admin/companies/{$tenant->id}/activation", ['plan_id' => $plan->id, 'payment_method' => 'crypto'])
            ->assertStatus(422);
    }
}
