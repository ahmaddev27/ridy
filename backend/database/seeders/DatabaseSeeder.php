<?php

namespace Database\Seeders;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(RolePermissionSeeder::class);
        $this->call(PostalCodesSeeder::class);

        // Platform owner — cross-tenant super-admin (no tenant of their own).
        $admin = User::firstOrCreate(
            ['email' => 'admin@reidey.app'],
            [
                'name' => 'Platform Admin',
                'password' => Hash::make(env('SUPERADMIN_PASSWORD', 'password')),
                'tenant_id' => null,
            ],
        );
        $admin->assignRole('super_admin');

        $tenant = Tenant::firstOrCreate(
            ['name' => 'YA Mobility'],
            ['country' => 'DE', 'status' => 'active'],
        );

        $manager = User::firstOrCreate(
            ['email' => 'manager@fleet.de'],
            [
                'name' => 'Yassin Asfour',
                'password' => Hash::make('password'),
                'tenant_id' => $tenant->id,
            ],
        );

        $manager->assignRole('fleet_manager');
    }
}
