<?php

namespace Tests\Feature\Platform;

use App\Domain\Audit\AuditLogger;
use App\Domain\Audit\Models\AuditLog;
use App\Domain\Billing\Models\Plan;
use App\Domain\Tenancy\CompanyDataPurger;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AuditTrailTest extends TestCase
{
    use RefreshDatabase;

    private function superAdmin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_admin_mutation_is_audited_as_a_platform_entry_with_secrets_redacted(): void
    {
        $admin = $this->superAdmin();
        Sanctum::actingAs($admin);

        $this->putJson('/api/v1/admin/settings', ['smtp_host' => 'smtp.example', 'smtp_password' => 'topsecret'])->assertOk();

        $log = AuditLog::where('actor_id', $admin->id)->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertNull($log->tenant_id);
        $this->assertSame('PUT', $log->context['method']);
        $this->assertSame('smtp.example', $log->context['input']['smtp_host']);
        $this->assertSame('[redacted]', $log->context['input']['smtp_password']);
        $this->assertStringNotContainsString('topsecret', json_encode($log->context));
    }

    public function test_admin_reads_and_failed_mutations_are_not_audited(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->getJson('/api/v1/admin/plans')->assertOk();
        $this->postJson('/api/v1/admin/plans', ['name' => 'Bad', 'price' => 10, 'duration_days' => 0])->assertStatus(422);

        $this->assertSame(0, AuditLog::count());
    }

    public function test_queue_flush_writes_one_explicit_entry(): void
    {
        $admin = $this->superAdmin();
        Sanctum::actingAs($admin);
        DB::table('failed_jobs')->insert(['uuid' => 'u-1', 'connection' => 'database', 'queue' => 'default', 'payload' => '{}', 'exception' => 'x', 'failed_at' => now()]);

        $this->postJson('/api/v1/admin/queue/flush')->assertOk();

        $logs = AuditLog::all();
        $this->assertCount(1, $logs);
        $this->assertSame('queue.flush', $logs->first()->action);
        $this->assertSame(1, $logs->first()->context['count']);
    }

    public function test_manager_mutations_are_not_audited_by_the_middleware(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => $tenant->id]);
        $manager->assignRole('fleet_manager');
        Sanctum::actingAs($manager);

        $this->postJson('/api/v1/admin/plans', ['name' => 'X', 'price' => 1, 'duration_days' => 1])->assertForbidden();

        $this->assertSame(0, AuditLog::count());
    }

    public function test_impersonated_actions_are_attributed_to_the_impersonator(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => 'x', 'tenant_id' => null]);
        $manager = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => 'x', 'tenant_id' => $tenant->id]);

        $session = $this->app['session']->driver();
        $session->put('impersonator_id', $admin->id);
        request()->setLaravelSession($session);
        $this->actingAs($manager);

        app(AuditLogger::class)->log('offers.bulk_delete', null, ['count' => 3], $tenant->id);

        $log = AuditLog::first();
        $this->assertSame($admin->id, (int) $log->actor_id);
        $this->assertSame($manager->id, $log->context['as_user_id']);
        $this->assertSame($tenant->id, (int) $log->tenant_id);
    }

    public function test_company_purge_is_audited_under_the_tenant(): void
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);

        app(CompanyDataPurger::class)->purge($tenant);

        $log = AuditLog::where('action', 'fleet_session.purge')->first();
        $this->assertNotNull($log);
        $this->assertSame($tenant->id, (int) $log->tenant_id);
        $this->assertArrayHasKey('offers', $log->context['counts']);
    }

    public function test_used_plan_is_archived_not_deleted(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $used = Plan::create(['name' => 'Annual', 'price' => 200, 'duration_days' => 365, 'active' => true]);
        $unused = Plan::create(['name' => 'Trial', 'price' => 0, 'duration_days' => 7, 'active' => true]);
        DB::table('subscription_codes')->insert([
            'code' => 'ABC123', 'plan_id' => $used->id, 'tenant_id' => $tenant->id,
            'expires_at' => now()->addDay(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->deleteJson("/api/v1/admin/plans/{$used->id}")->assertOk()->assertJsonPath('data.archived', true);
        $this->deleteJson("/api/v1/admin/plans/{$unused->id}")->assertOk()->assertJsonPath('data.deleted', true);

        $this->assertFalse((bool) Plan::find($used->id)->active);
        $this->assertNull(Plan::find($unused->id));
        $this->assertSame($used->id, (int) DB::table('subscription_codes')->value('plan_id'));
    }
}
