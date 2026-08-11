<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\Registration;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CompanyRegistrationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    public function test_start_creates_a_pending_registration_and_hashes_the_password(): void
    {
        $this->postJson('/api/v1/register', [
            'company_name' => 'Acme Fleet',
            'name' => 'Alex Manager',
            'phone' => '+49123456',
            'email' => 'alex@acme.de',
            'password' => 'super-secret',
        ])->assertOk()->assertJsonPath('data.email', 'alex@acme.de');

        $registration = Registration::where('email', 'alex@acme.de')->firstOrFail();
        $this->assertSame('Acme Fleet', $registration->company_name);
        $this->assertNotSame('super-secret', $registration->password);
        $this->assertMatchesRegularExpression('/^\d{6}$/', $registration->otp);
        $this->assertDatabaseMissing('tenants', ['name' => 'Acme Fleet']);
    }

    public function test_verify_creates_the_company_and_a_verified_owner_then_clears_the_registration(): void
    {
        $registration = Registration::create([
            'email' => 'owner@acme.de',
            'company_name' => 'Acme Fleet',
            'name' => 'Owner',
            'password' => Hash::make('super-secret'),
            'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10),
            'attempts' => 0,
        ]);

        $this->postJson('/api/v1/register/verify', [
            'email' => 'owner@acme.de',
            'otp' => '123456',
        ])->assertOk()->assertJsonPath('data.verified', true);

        $tenant = Tenant::where('name', 'Acme Fleet')->firstOrFail();
        $owner = User::where('email', 'owner@acme.de')->firstOrFail();
        $this->assertSame($tenant->id, $owner->tenant_id);
        $this->assertTrue($owner->hasRole('fleet_manager'));
        $this->assertNotNull($owner->email_verified_at);
        $this->assertTrue(Hash::check('super-secret', $owner->password));
        $this->assertModelMissing($registration);
    }

    public function test_verify_rejects_a_wrong_code_and_counts_the_attempt(): void
    {
        Registration::create([
            'email' => 'owner@acme.de',
            'company_name' => 'Acme Fleet',
            'name' => 'Owner',
            'password' => Hash::make('super-secret'),
            'otp' => '123456',
            'otp_expires_at' => CarbonImmutable::now()->addMinutes(10),
            'attempts' => 0,
        ]);

        $this->postJson('/api/v1/register/verify', [
            'email' => 'owner@acme.de',
            'otp' => '000000',
        ])->assertStatus(422);

        $this->assertSame(1, Registration::where('email', 'owner@acme.de')->value('attempts'));
        $this->assertDatabaseMissing('tenants', ['name' => 'Acme Fleet']);
    }

    public function test_start_rejects_an_email_already_registered_as_a_user(): void
    {
        $tenant = Tenant::create(['name' => 'Existing', 'country' => 'DE']);
        User::create([
            'name' => 'Taken', 'email' => 'taken@acme.de',
            'password' => Hash::make('password'), 'tenant_id' => $tenant->id,
        ]);

        $this->postJson('/api/v1/register', [
            'company_name' => 'Acme Fleet',
            'name' => 'Alex',
            'phone' => '+49123456',
            'email' => 'taken@acme.de',
            'password' => 'super-secret',
        ])->assertStatus(422)->assertJsonValidationErrors('email');
    }
}
