<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a street-less pickup/dropoff resolves to a railway station, we rewrite the
 * address to the station's full street address AND keep the station's name in its
 * own field (per spec — the name never goes into the routing address).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->string('pickup_station_name')->nullable()->after('pickup_address');
            $table->string('dropoff_station_name')->nullable()->after('dropoff_address');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn(['pickup_station_name', 'dropoff_station_name']);
        });
    }
};
