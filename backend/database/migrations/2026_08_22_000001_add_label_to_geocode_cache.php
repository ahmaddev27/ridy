<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cache the short German address label alongside the coordinates, so a cached
 * hit can also unify an offer's displayed address to German — not just the very
 * first (uncached) geocode of that address.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('geocode_cache', function (Blueprint $table) {
            $table->string('label')->nullable()->after('lng');
        });
    }

    public function down(): void
    {
        Schema::table('geocode_cache', function (Blueprint $table) {
            $table->dropColumn('label');
        });
    }
};
