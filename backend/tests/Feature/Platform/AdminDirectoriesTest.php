<?php

namespace Tests\Feature\Platform;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDirectoriesTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'Admin', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_driver_directory_shows_the_newest_active_offer(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create(['tenant_id' => $tenant->id, 'name' => 'D', 'online_status' => 'ONLINE']);
        $base = ['tenant_id' => $tenant->id, 'driver_id' => $driver->id, 'driver_uuid' => 'u', 'raw_payload' => [], 'status' => OfferStatus::Accepted];
        DispatchOffer::withoutGlobalScopes()->create($base + ['offer_uuid' => 'old', 'received_at' => now()->subMinutes(30)]);
        $newest = DispatchOffer::withoutGlobalScopes()->create($base + ['offer_uuid' => 'new', 'received_at' => now()->subMinute()]);
        app(TenantContext::class)->forget();

        $this->getJson('/api/v1/admin/drivers')
            ->assertOk()
            ->assertJsonPath('data.0.active_offer.id', $newest->id);
    }

    public function test_user_directory_reports_open_ended_companies_as_active_and_filters(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
        User::create(['name' => 'Manager', 'email' => 'm@acme.de', 'password' => 'x', 'tenant_id' => $tenant->id]);
        Driver::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'name' => 'Driver', 'activated_at' => now()]);

        $rows = collect($this->getJson('/api/v1/admin/users')->assertOk()->json('data'));
        $this->assertSame('active', $rows->firstWhere('email', 'm@acme.de')['status']);
        $this->assertTrue($rows->contains('kind', 'driver'));

        $only = collect($this->getJson('/api/v1/admin/users?kind=user&q=acme')->assertOk()->json('data'));
        $this->assertSame(['m@acme.de'], $only->pluck('email')->all());
    }

    public function test_client_log_lines_are_attributed_and_the_file_rotates(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $user = User::create(['name' => 'V', 'email' => 'v@acme.de', 'password' => 'x', 'tenant_id' => $tenant->id]);
        Sanctum::actingAs($user);

        $path = storage_path('logs/frontend.log');
        @unlink($path.'.1');
        file_put_contents($path, str_repeat('x', 2_000_001));

        $this->postJson('/api/v1/client-log', ['message' => "boom\nforged", 'url' => '/x'])->assertOk();

        $this->assertFileExists($path.'.1');
        $line = (string) file_get_contents($path);
        $this->assertStringContainsString("u:{$user->id} c:{$tenant->id}", $line);
        $this->assertSame(1, substr_count($line, "\n"));

        @unlink($path);
        @unlink($path.'.1');
    }
}
