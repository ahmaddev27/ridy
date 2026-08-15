<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Jobs\SendAdminBroadcast;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminBroadcastTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    private function superAdmin(): User
    {
        $admin = User::create(['name' => 'Admin', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    private function manager(string $email): User
    {
        $tenant = Tenant::create(['name' => 'Acme '.$email, 'country' => 'DE']);
        $m = User::create(['name' => 'M', 'email' => $email, 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $m->assignRole('fleet_manager');

        return $m;
    }

    public function test_broadcast_to_selected_users_queues_the_job(): void
    {
        Queue::fake();
        $m1 = $this->manager('m1@a.de');
        $m2 = $this->manager('m2@a.de');
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/notifications/broadcast', [
            'title' => 'Maintenance',
            'body' => 'The dashboard will be down tonight.',
            'href' => '/admin',
            'user_ids' => [$m1->id, $m2->id],
        ])->assertOk()->assertJsonPath('queued', 2);

        Queue::assertPushed(SendAdminBroadcast::class);
    }

    public function test_broadcast_by_role_runs_and_creates_bell_notifications(): void
    {
        // Run the job inline so we can assert the actual bell writes.
        config(['queue.default' => 'sync']);
        $m1 = $this->manager('m1@a.de');
        $m2 = $this->manager('m2@a.de');
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/notifications/broadcast', [
            'title' => 'Fleet update',
            'body' => 'Please re-link your Uber session.',
            'role' => 'fleet_manager',
        ])->assertOk()->assertJsonPath('queued', 2);

        $this->assertSame(1, $m1->fresh()->notifications()->count());
        $this->assertSame('admin_broadcast', $m1->fresh()->notifications()->first()->data['type']);
        $this->assertSame('Fleet update', $m1->fresh()->notifications()->first()->data['params']['title']);
        $this->assertSame(1, $m2->fresh()->notifications()->count());
    }

    public function test_empty_audience_is_rejected(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/v1/admin/notifications/broadcast', [
            'title' => 'Hi', 'body' => 'Nobody', 'user_ids' => [],
        ])->assertStatus(422);
    }

    public function test_manager_cannot_broadcast(): void
    {
        Sanctum::actingAs($this->manager('m@a.de'));

        $this->postJson('/api/v1/admin/notifications/broadcast', [
            'title' => 'Hi', 'body' => 'nope', 'all' => true,
        ])->assertForbidden();
    }
}
