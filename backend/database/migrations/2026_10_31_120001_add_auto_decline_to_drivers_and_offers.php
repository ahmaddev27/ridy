<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Auto-decline ("Early decline") foundation — docs/25.
 *
 * Driver-level opt-in + rules live as JSON on the driver (like tenant settings);
 * the auto-decline log is the offer row itself (auto_decline_reason), so no new
 * tables. Nothing reads these yet — the engine lands in a later phase.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            // { enabled: bool, rules: { min_fare, reject_cities, max_pickup_distance, max_trip_distance } }
            // Null = never configured. See docs/25 for the shape.
            $table->json('auto_decline')->nullable()->after('trip_waypoints');
        });

        Schema::table('dispatch_offers', function (Blueprint $table) {
            // Which rule fired (min_fare|reject_cities|max_pickup_distance|max_trip_distance),
            // or null for a manual/other decline. The offer row IS the auto-decline log.
            $table->string('auto_decline_reason', 32)->nullable()->after('dispatch_rejected_at');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', fn (Blueprint $table) => $table->dropColumn('auto_decline'));
        Schema::table('dispatch_offers', fn (Blueprint $table) => $table->dropColumn('auto_decline_reason'));
    }
};
