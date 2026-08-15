<?php

namespace Tests\Feature;

use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class NotifierTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    private function admin(): User
    {
        $u = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('x'), 'tenant_id' => null]);
        $u->assignRole('super_admin');

        return $u;
    }

    public function test_to_admins_targets_only_super_admins(): void
    {
        $admin = $this->admin();
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        app(Notifier::class)->toAdmins('company_registered', ['company' => 'Acme'], '/admin/companies');

        $this->assertSame(1, $admin->fresh()->notifications()->count());
        $this->assertSame(0, $manager->fresh()->notifications()->count());
        $this->assertSame('Acme', $admin->fresh()->notifications()->first()->data['params']['company']);
    }

    public function test_dedupe_skips_a_second_unread_of_the_same_type(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('x'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');

        $notifier = app(Notifier::class);
        $notifier->toTenant($tenant->id, 'session_needs_relink', [], '/connections', dedupe: true);
        $notifier->toTenant($tenant->id, 'session_needs_relink', [], '/connections', dedupe: true);

        // Deduped: still only one unread of that type.
        $this->assertSame(1, $manager->fresh()->unreadNotifications()->count());
    }
}
