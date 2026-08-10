<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Live online/offline presence for drivers, captured from Uber's supplier
 * GetDriverLiveLocation. Stored on the driver row and refreshed on demand.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->string('online_status')->nullable()->after('uber_status'); // raw Uber driverStatus
            $table->timestamp('location_updated_at')->nullable()->after('online_status');
            $table->timestamp('status_synced_at')->nullable()->after('location_updated_at');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['online_status', 'location_updated_at', 'status_synced_at']);
        });
    }
};
