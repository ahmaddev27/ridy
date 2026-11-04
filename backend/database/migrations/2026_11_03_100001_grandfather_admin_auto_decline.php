<?php

use App\Domain\Fleet\Models\Driver;
use Illuminate\Database\Migrations\Migration;

/**
 * Early decline now needs the company admin's permission (`admin_enabled`) on top of
 * the driver's own switch. Grandfather every driver who already switched it on so they
 * keep working. Iterates via Eloquent (not JSON_SET) to stay portable SQLite + MySQL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Driver::withoutGlobalScopes()->whereNotNull('auto_decline')->each(function (Driver $driver) {
            $config = $driver->auto_decline;
            if (($config['enabled'] ?? false) !== true || array_key_exists('admin_enabled', $config)) {
                return;
            }

            $driver->forceFill(['auto_decline' => $config + ['admin_enabled' => true]])->save();
        });
    }

    public function down(): void
    {
        // Intentionally a no-op: stripping the key would silently revoke permission that
        // the admin may since have set deliberately.
    }
};
