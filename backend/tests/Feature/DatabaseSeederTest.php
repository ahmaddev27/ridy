<?php

namespace Tests\Feature;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * The first deploy on a fresh box runs `db:seed`. It must never create a
 * guessable platform account there: no demo fleet/manager outside local/testing,
 * and the super-admin only with a strong SUPERADMIN_PASSWORD.
 */
class DatabaseSeederTest extends TestCase
{
    use RefreshDatabase;

    private const STRONG_PASSWORD = 'k3P9v-QwZ2rT8mYx4LbN';

    private function asProduction(?string $superAdminPassword): void
    {
        $this->app['env'] = 'production';
        config(['app.superadmin_password' => $superAdminPassword]);
    }

    /** Run the seeder directly (db:seed would prompt for confirmation in production). */
    private function runSeeder(): void
    {
        $this->app->make(DatabaseSeeder::class)->setContainer($this->app)->__invoke();
    }

    public function test_local_seed_creates_the_admin_and_the_demo_fleet(): void
    {
        $this->runSeeder();

        $admin = User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->firstOrFail();
        $this->assertTrue($admin->hasRole('super_admin'));
        $this->assertTrue(User::where('email', DemoSeeder::MANAGER_EMAIL)->exists());
    }

    public function test_production_seed_refuses_a_missing_password(): void
    {
        $this->asProduction(null);

        try {
            $this->runSeeder();
            $this->fail('Seeding production without SUPERADMIN_PASSWORD must throw.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('SUPERADMIN_PASSWORD', $e->getMessage());
        }

        $this->assertFalse(User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->exists());
    }

    public function test_production_seed_refuses_the_default_and_short_passwords(): void
    {
        foreach (['password', 'PASSWORD', 'short-secret'] as $weak) {
            $this->asProduction($weak);

            try {
                $this->runSeeder();
                $this->fail("Seeding production with '{$weak}' must throw.");
            } catch (RuntimeException) {
                // expected
            }
        }

        $this->assertFalse(User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->exists());
    }

    public function test_production_seed_uses_the_configured_password_and_skips_demo_data(): void
    {
        $this->asProduction(self::STRONG_PASSWORD);

        $this->runSeeder();

        $admin = User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->firstOrFail();
        $this->assertTrue(Hash::check(self::STRONG_PASSWORD, $admin->password));
        $this->assertFalse(Hash::check('password', $admin->password));
        $this->assertTrue($admin->hasRole('super_admin'));

        $this->assertFalse(User::where('email', DemoSeeder::MANAGER_EMAIL)->exists());
        $this->assertFalse(Tenant::where('name', 'YA Mobility')->exists());
    }

    public function test_rerun_in_production_leaves_an_existing_admin_untouched(): void
    {
        $this->asProduction(self::STRONG_PASSWORD);
        $this->runSeeder();
        $hash = User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->value('password');

        // A later re-seed (e.g. to refresh roles) needs no password and must not
        // reset the live admin's credentials.
        $this->asProduction(null);
        $this->runSeeder();

        $this->assertSame($hash, User::where('email', DatabaseSeeder::PLATFORM_ADMIN_EMAIL)->value('password'));
    }
}
