<?php

namespace Database\Seeders;

use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Local development fixture: one demo fleet and its manager with a known
 * password. DatabaseSeeder calls it only in the local/testing environments, so
 * it can never create a guessable account on a real server.
 */
class DemoSeeder extends Seeder
{
    public const MANAGER_EMAIL = 'manager@fleet.de';

    public function run(): void
    {
        $tenant = Tenant::firstOrCreate(
            ['name' => 'YA Mobility'],
            ['country' => 'DE', 'status' => 'active'],
        );

        $manager = User::firstOrCreate(
            ['email' => self::MANAGER_EMAIL],
            [
                'name' => 'Yassin Asfour',
                'password' => Hash::make('password'),
                'tenant_id' => $tenant->id,
            ],
        );

        $manager->assignRole('fleet_manager');
    }
}
