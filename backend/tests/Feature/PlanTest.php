<?php

namespace Tests\Feature;

use App\Domain\Billing\Models\Plan;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PlanTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_admin_creates_and_lists_plans(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/plans', ['name' => 'Annual', 'price' => 200, 'duration_days' => 365])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Annual')
            ->assertJsonPath('data.duration_days', 365)
            ->assertJsonPath('data.active', true);

        $this->getJson('/api/v1/admin/plans')->assertOk()->assertJsonPath('data.0.price', 200);
    }

    public function test_plan_requires_a_positive_duration(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $this->postJson('/api/v1/admin/plans', ['name' => 'Bad', 'price' => 10, 'duration_days' => 0])->assertStatus(422);
    }

    public function test_non_admin_forbidden(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $u = User::create(['name' => 'M', 'email' => 'm@x.de', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $u->assignRole('fleet_manager');
        Sanctum::actingAs($u);
        $this->getJson('/api/v1/admin/plans')->assertForbidden();
    }

    public function test_admin_updates_and_deletes_a_plan(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $plan = Plan::create(['name' => 'Monthly', 'price' => 20, 'duration_days' => 30]);

        $this->putJson("/api/v1/admin/plans/{$plan->id}", ['name' => 'Monthly', 'price' => 25, 'duration_days' => 30, 'active' => false])
            ->assertOk()->assertJsonPath('data.price', 25)->assertJsonPath('data.active', false);

        $this->deleteJson("/api/v1/admin/plans/{$plan->id}")->assertOk();
        $this->assertDatabaseMissing('plans', ['id' => $plan->id]);
    }
}
