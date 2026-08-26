<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records the precision of an offer's resolved geography (the geocoding cascade's
 * tier): exact | street | area | postal | approx | estimated. Stored on the offer
 * for the UI to badge, and cached alongside each geocode so a cached hit keeps its
 * tier. See docs/address-resolution-plan.md (Phases 2 & 4).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('geocode_cache', function (Blueprint $table) {
            $table->string('confidence', 16)->nullable()->after('label');
        });

        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->string('geo_confidence', 16)->nullable()->after('route_geometry');
        });
    }

    public function down(): void
    {
        Schema::table('geocode_cache', function (Blueprint $table) {
            $table->dropColumn('confidence');
        });

        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn('geo_confidence');
        });
    }
};
