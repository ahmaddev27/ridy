<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Authoritative trip geometry from Uber's live map. Once a driver accepts and
 * goes en-route, Uber's GetDriverLiveLocation returns the real pickup/dropoff
 * (and any extra stops) as waypoints — a truth source that fixes offers whose
 * text-only address couldn't be geocoded, and reveals multi-stop trips.
 *
 * Column position is left to the engine (no ->after()): chaining ->after() onto
 * columns added in the SAME ALTER errors on some MySQL versions, which silently
 * aborted this migration in production. Each add is guarded with hasColumn so the
 * migration is idempotent and safe to re-run after that partial failure.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            // 'geocode' (our Nominatim/OSRM guess) or 'uber' (live-map waypoints).
            if (! Schema::hasColumn('dispatch_offers', 'geo_source')) {
                $table->string('geo_source', 16)->nullable();
            }
            // Ordered [{lat,lng}] from Uber's waypoints: pickup first, then each drop-off.
            if (! Schema::hasColumn('dispatch_offers', 'stops')) {
                $table->json('stops')->nullable();
            }
            // Number of drop-off points (>= 2 = a multi-stop trip).
            if (! Schema::hasColumn('dispatch_offers', 'stops_count')) {
                $table->unsignedTinyInteger('stops_count')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn(['geo_source', 'stops', 'stops_count']);
        });
    }
};
