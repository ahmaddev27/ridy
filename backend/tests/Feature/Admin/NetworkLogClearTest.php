<?php

namespace Tests\Feature\Admin;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NetworkLogClearTest extends TestCase
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

    public function test_clear_deletes_every_row_and_reports_the_count(): void
    {
        foreach (range(1, 12) as $i) {
            DispatchNetworkLog::record(null, 'status', ['seq' => $i], 'sync '.$i, 1);
        }
        $this->assertSame(12, DispatchNetworkLog::count());

        Sanctum::actingAs($this->superAdmin());

        $this->deleteJson('/api/v1/admin/network-logs')
            ->assertOk()
            ->assertJsonPath('data.deleted', 12);

        $this->assertSame(0, DispatchNetworkLog::count());
    }
}
