<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    public const PLATFORM_ADMIN_EMAIL = 'admin@reidey.app';

    /** Minimum length of the bootstrap super-admin password outside local/testing. */
    public const MIN_PASSWORD_LENGTH = 16;

    public function run(): void
    {
        $this->call(RolePermissionSeeder::class);
        $this->call(PostalCodesSeeder::class);

        $this->seedPlatformAdmin();

        // The demo fleet and its manager (known password) exist only for local
        // development and tests — never on a real server.
        if (app()->environment('local', 'testing')) {
            $this->call(DemoSeeder::class);
        }
    }

    /**
     * The platform owner — a cross-tenant super-admin with no tenant of their
     * own. Created once; a re-run never touches an existing account.
     */
    private function seedPlatformAdmin(): void
    {
        $admin = User::where('email', self::PLATFORM_ADMIN_EMAIL)->first();

        if ($admin === null) {
            $admin = User::create([
                'email' => self::PLATFORM_ADMIN_EMAIL,
                'name' => 'Platform Admin',
                'password' => Hash::make($this->platformAdminPassword()),
                'tenant_id' => null,
            ]);
        }

        $admin->assignRole('super_admin');
    }

    /**
     * Outside local/testing the password must come from SUPERADMIN_PASSWORD and
     * be strong: a fresh server used to come up with admin@reidey.app/password,
     * a cross-tenant account anyone could guess.
     */
    private function platformAdminPassword(): string
    {
        $configured = (string) config('app.superadmin_password');

        if (app()->environment('local', 'testing')) {
            return $configured !== '' ? $configured : 'password';
        }

        if (mb_strlen($configured) < self::MIN_PASSWORD_LENGTH || strtolower($configured) === 'password') {
            throw new RuntimeException(sprintf(
                'Refusing to create %s: set SUPERADMIN_PASSWORD to a random value of at least %d characters.',
                self::PLATFORM_ADMIN_EMAIL,
                self::MIN_PASSWORD_LENGTH,
            ));
        }

        return $configured;
    }
}
