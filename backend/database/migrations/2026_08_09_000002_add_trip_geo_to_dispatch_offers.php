<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cache the geocoded pickup/dropoff coordinates, road distance and route
 * geometry on each offer so the trip map + price-per-km are computed once
 * (lazily on first detail view) and served instantly thereafter.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->decimal('pickup_lat', 10, 7)->nullable()->after('dropoff_address');
            $table->decimal('pickup_lng', 10, 7)->nullable()->after('pickup_lat');
            $table->decimal('dropoff_lat', 10, 7)->nullable()->after('pickup_lng');
            $table->decimal('dropoff_lng', 10, 7)->nullable()->after('dropoff_lat');
            $table->unsignedInteger('distance_m')->nullable()->after('dropoff_lng');
            $table->json('route_geometry')->nullable()->after('distance_m');
            $table->timestamp('geo_synced_at')->nullable()->after('route_geometry');
        });

        // Shared address→coordinate cache (dedupes identical addresses across
        // offers; respects Nominatim's usage policy by never re-querying).
        Schema::create('geocode_cache', function (Blueprint $table) {
            $table->id();
            $table->string('query')->unique();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn([
                'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
                'distance_m', 'route_geometry', 'geo_synced_at',
            ]);
        });
        Schema::dropIfExists('geocode_cache');
    }
};
