<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Live coordinates for the fleet map. Uber's GetDriverLiveLocation returns real
 * lat/long only while a driver is engaged (EN_ROUTE / ON_TRIP) — offline/idle
 * drivers come back as 0,0, so these stay null for them. trip_waypoints holds
 * the current trip's pickup/dropoff points for drawing the route.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('location_updated_at');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $table->decimal('heading', 6, 2)->nullable()->after('longitude');
            $table->json('trip_waypoints')->nullable()->after('heading');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude', 'heading', 'trip_waypoints']);
        });
    }
};
