<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OverviewStatsTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_companies_counts_only_truly_active_ones(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        // One truly active company, one whose subscription has lapsed (expired).
        Tenant::create(['name' => 'Active Co', 'country' => 'DE', 'status' => 'active', 'activated_at' => now(), 'subscription_ends_at' => now()->addDays(10)]);
        Tenant::create(['name' => 'Expired Co', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()->subMonths(2), 'subscription_ends_at' => now()->subDay()]);

        Sanctum::actingAs($admin);
        $res = $this->getJson('/api/v1/admin/overview')->assertOk();

        // The health donut must agree with the row's status badge: the expired
        // company is NOT active, so active=1, inactive=1 (not 2/0).
        $res->assertJsonPath('data.stats.companies', 2)
            ->assertJsonPath('data.stats.active_companies', 1);
    }
}
