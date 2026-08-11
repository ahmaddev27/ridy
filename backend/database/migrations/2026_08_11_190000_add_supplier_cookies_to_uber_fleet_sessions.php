<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            // A second cookie jar scoped to supplier.uber.com. The RAMEN stream
            // uses `cookies` (vsdispatch scope); supplier's roster/status APIs need
            // their own host-scoped cookies, so the daemon replays these instead —
            // keeping the working offer stream untouched. Encrypted at rest.
            $table->text('supplier_cookies')->nullable()->after('cookies'); // encrypted:array
        });
    }

    public function down(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->dropColumn('supplier_cookies');
        });
    }
};
