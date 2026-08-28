<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Authoritative German railway-station addresses, imported from the DB InfraGO
 * OpenStation NeTEx dataset (see App\Console\Commands\SyncRailwayStations).
 *
 * Purpose: when a dispatch pickup arrives as a bare "PLZ City" (no street) — the
 * common station-pickup case — StationResolver looks the station up here by
 * (postal_code, normalized_city) in O(1) and returns the full street address,
 * so the driver sees "Europaplatz 1, 10557 Berlin" instead of "10557 Berlin".
 * All lookups are local + indexed; nothing hits the network at request time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('railway_stations', function (Blueprint $table) {
            $table->id();

            // Identity from OpenStation.
            $table->string('dhid')->unique();              // StopPlace @id (stable key)
            $table->string('eva')->nullable()->index();    // EVA number
            $table->string('ds100')->nullable();           // RIL/RL100 (DS100) code
            $table->string('stada')->nullable();           // STADA number
            $table->string('category')->nullable();        // DB InfraGO station category

            $table->string('name');                        // "Berlin Hauptbahnhof"

            // Postal address (street already carries the house number in OpenStation).
            $table->string('street_line')->nullable();     // full "Europaplatz 1"
            $table->string('street')->nullable();          // "Europaplatz" (best-effort split)
            $table->string('house_number')->nullable();    // "1" (best-effort split; may be null)
            $table->char('postal_code', 5)->nullable();
            $table->string('city')->nullable();            // display city, original casing
            $table->string('normalized_city')->nullable(); // fold for lookup (münchen=muenchen)

            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();

            $table->string('source')->default('DB InfraGO OpenStation');
            $table->timestamps();

            // Hot-path lookup: exact (postal_code, normalized_city). A second index
            // on postal_code alone covers the PLZ-only fallback + ambiguity check.
            $table->index(['postal_code', 'normalized_city'], 'idx_station_plz_city');
            $table->index('postal_code', 'idx_station_plz');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('railway_stations');
    }
};
