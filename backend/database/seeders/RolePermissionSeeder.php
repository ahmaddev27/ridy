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
            // Platform-owner (super-admin) permissions.
            'companies.manage',
            'companies.users.manage',
            'companies.sessions.manage',
            'platform.view',
            // Reseller — issues activation codes against a plan for a company.
            'codes.generate',
        ];

        foreach ($permissions as $permission) {
            Permission::findOrCreate($permission);
        }

        $roles = [
            // Platform owner — full cross-tenant control.
            'super_admin' => $permissions,
            'owner' => ['offers.view', 'drivers.manage', 'connections.manage', 'audit.view', 'users.manage'],
            'fleet_manager' => ['offers.view', 'drivers.manage', 'connections.manage', 'audit.view'],
            'driver' => ['offers.view'],
            'viewer' => ['offers.view'],
            // A reseller only generates activation codes — no fleet/admin access.
            'reseller' => ['codes.generate'],
        ];

        foreach ($roles as $role => $grantedPermissions) {
            Role::findOrCreate($role)->syncPermissions($grantedPermissions);
        }
    }
}
