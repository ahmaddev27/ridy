<?php

use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Artisan;

/**
 * Re-sync roles and permissions from RolePermissionSeeder.
 *
 * The seeder only runs on a company's FIRST deploy, so a permission added later
 * (here: `offers.manage`, which now gates the two offer-delete routes) would not
 * exist in an established database and `can:offers.manage` would deny everyone —
 * including the owner. The seeder is idempotent (findOrCreate + syncPermissions),
 * so running it from a migration is safe and keeps the role table matching the
 * code that enforces it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Artisan::call('db:seed', ['--class' => RolePermissionSeeder::class, '--force' => true]);

        // Now that the dashboard's mutating routes carry `can:`, a tenant user with
        // NO role would lose access the moment this ships. Every user is created as
        // a fleet_manager today, so a role-less one is historical data — give it the
        // role it has always behaved as, rather than silently locking it out.
        User::whereNotNull('tenant_id')
            ->whereDoesntHave('roles')
            ->each(fn (User $user) => $user->assignRole('fleet_manager'));
    }

    public function down(): void
    {
        // Role definitions live in the seeder; there is nothing meaningful to undo.
    }
};
