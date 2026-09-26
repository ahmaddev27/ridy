<?php

namespace Tests\Feature;

use App\Domain\Notifications\Models\UserPushToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DELETE /notifications/device must reach unregisterDevice — it used to be
 * swallowed by the notifications/{id} wildcard, so logout left the row behind.
 */
class WebPushDeviceRouteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
    }

    private function manager(): User
    {
        $tenant = Tenant::create(['name' => 'Acme', 'country' => 'DE']);
        $manager = User::create([
            'name' => 'M',
            'email' => 'm@a.de',
            'password' => Hash::make('x'),
            'tenant_id' => $tenant->id,
        ]);
        $manager->assignRole('fleet_manager');

        return $manager;
    }

    public function test_delete_device_removes_the_push_token_row(): void
    {
        $manager = $this->manager();
        UserPushToken::create(['user_id' => $manager->id, 'token' => 'web-1']);
        UserPushToken::create(['user_id' => $manager->id, 'token' => 'web-2']);

        $this->actingAs($manager)
            ->deleteJson('/api/v1/notifications/device', ['token' => 'web-1'])
            ->assertNoContent();

        $this->assertDatabaseMissing('user_push_tokens', ['user_id' => $manager->id, 'token' => 'web-1']);
        $this->assertDatabaseHas('user_push_tokens', ['user_id' => $manager->id, 'token' => 'web-2']);
    }

    public function test_delete_by_uuid_still_removes_a_notification(): void
    {
        $manager = $this->manager();
        $id = (string) Str::uuid();
        DB::table('notifications')->insert([
            'id' => $id,
            'type' => 'test',
            'notifiable_type' => $manager->getMorphClass(),
            'notifiable_id' => $manager->id,
            'data' => '{}',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($manager)
            ->deleteJson("/api/v1/notifications/{$id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('notifications', ['id' => $id]);
    }
}
