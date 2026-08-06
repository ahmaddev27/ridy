<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RolePermissionSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $permissions = [
            'offers.view',
            'drivers.manage',
            'connections.manage',
            'audit.view',
            'users.manage',
        ];

        foreach ($permissions as $permission) {
            Permission::findOrCreate($permission);
        }

        $roles = [
            'owner' => $permissions,
            'fleet_manager' => ['offers.view', 'drivers.manage', 'connections.manage', 'audit.view'],
            'driver' => ['offers.view'],
            'viewer' => ['offers.view'],
        ];

        foreach ($roles as $role => $grantedPermissions) {
            Role::findOrCreate($role)->syncPermissions($grantedPermissions);
        }
    }
}
