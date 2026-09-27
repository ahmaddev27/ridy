<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Production logs daily (laravel-YYYY-MM-DD.log). The admin log viewer must
 * follow the file being written now, not the retired single laravel.log.
 */
class LogViewerDailyTest extends TestCase
{
    use RefreshDatabase;

    private string $dailyLog;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dailyLog = storage_path('logs/laravel-2099-12-31.log');
    }

    protected function tearDown(): void
    {
        @unlink($this->dailyLog);
        parent::tearDown();
    }

    private function actAsSuperAdmin(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $admin = User::create([
            'name' => 'Admin', 'email' => 'admin@reidey.app', 'password' => Hash::make('password'), 'tenant_id' => null,
        ]);
        $admin->assignRole('super_admin');
        Sanctum::actingAs($admin);
    }

    public function test_backend_source_reads_the_newest_daily_log(): void
    {
        $this->actAsSuperAdmin();
        file_put_contents($this->dailyLog, "[2099-12-31 10:00:00] production.ERROR: daily-rotation-marker\n");
        touch($this->dailyLog, time() + 3600);

        $response = $this->getJson('/api/v1/admin/logs?source=backend')->assertOk();

        $this->assertStringContainsString('daily-rotation-marker', implode("\n", $response->json('data.lines')));
    }
}
