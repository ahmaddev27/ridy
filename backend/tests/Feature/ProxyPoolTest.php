<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProxyPoolTest extends TestCase
{
    use RefreshDatabase;

    private function usableTenant(string $name): Tenant
    {
        return Tenant::create(['name' => $name, 'country' => 'DE', 'status' => 'active', 'activated_at' => now()]);
    }

    public function test_assign_places_a_company_on_a_free_proxy(): void
    {
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://u:p@host:1', 'capacity' => 2]);
        $tenant = $this->usableTenant('Acme');

        app(ProxyPool::class)->assign($tenant);

        $tenant->refresh();
        $this->assertSame($proxy->id, $tenant->proxy_id);
        $this->assertSame('http://u:p@host:1', $tenant->proxy_url);
        // Capacity is measured in drivers: one driver occupies one slot.
        Driver::create(['tenant_id' => $tenant->id, 'name' => 'D1']);
        $this->assertSame(1, $proxy->usedCount());
    }

    public function test_full_proxy_is_skipped_then_freed_when_a_company_expires(): void
    {
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://u:p@host:1', 'capacity' => 1]);
        $a = $this->usableTenant('A');
        $b = $this->usableTenant('B');

        app(ProxyPool::class)->assign($a);
        Driver::create(['tenant_id' => $a->id, 'name' => 'D']); // fills the 1-driver capacity
        app(ProxyPool::class)->assign($b); // no free slot

        $this->assertSame($proxy->id, $a->fresh()->proxy_id);
        $this->assertNull($b->fresh()->proxy_id);

        // A's subscription expires → its drivers stop counting → slot frees → B can take it.
        $a->forceFill(['subscription_ends_at' => CarbonImmutable::now()->subDay()])->save();
        $this->assertSame(0, $proxy->usedCount());

        app(ProxyPool::class)->assign($b);
        $this->assertSame($proxy->id, $b->fresh()->proxy_id);
    }

    public function test_owner_activation_assigns_a_proxy(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $proxy = Proxy::create(['label' => 'P1', 'url' => 'http://u:p@host:1', 'capacity' => 5]);

        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE', 'status' => 'active']);
        $tenant->forceFill([
            'activation_code' => '123456',
            'activation_code_expires_at' => CarbonImmutable::now()->addMinutes(2),
            'activation_days' => 30,
        ])->save();
        User::create(['name' => 'O', 'email' => 'o@acme.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);

        $this->postJson('/api/v1/company/activate', [
            'email' => 'o@acme.de', 'password' => 'password', 'code' => '123456',
        ])->assertOk();

        $this->assertSame($proxy->id, $tenant->fresh()->proxy_id);
    }

    public function test_admin_crud_and_usage(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);

        $this->postJson('/api/v1/admin/proxies', ['label' => 'EU-1', 'url' => 'http://u:secret@h:8080', 'capacity' => 3])
            ->assertCreated()
            ->assertJsonPath('data.capacity', 3)
            ->assertJsonPath('data.used', 0);

        $this->getJson('/api/v1/admin/proxies')
            ->assertOk()
            ->assertJsonPath('data.0.label', 'EU-1')
            ->assertJsonPath('data.0.url_masked', 'http://••••@h:8080'); // creds never exposed
    }
}
