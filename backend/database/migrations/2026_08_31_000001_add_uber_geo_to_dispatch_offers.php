<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Authoritative trip geometry from Uber's live map. Once a driver accepts and
 * goes en-route, Uber's GetDriverLiveLocation returns the real pickup/dropoff
 * (and any extra stops) as waypoints — a truth source that fixes offers whose
 * text-only address couldn't be geocoded, and reveals multi-stop trips.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            // 'geocode' (our Nominatim/OSRM guess) or 'uber' (live-map waypoints).
            $table->string('geo_source', 16)->nullable()->after('geo_confidence');
            // Ordered [{lat,lng}] from Uber's waypoints: pickup first, then each
            // drop-off. Present only once resolved from the live map.
            $table->json('stops')->nullable()->after('geo_source');
            // Number of drop-off points (>= 2 = a multi-stop trip).
            $table->unsignedTinyInteger('stops_count')->nullable()->after('stops');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn(['geo_source', 'stops', 'stops_count']);
        });
    }
};
