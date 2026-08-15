<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks how many times we've tried (and failed) to geocode an offer's trip, so
 * the backfill retries transient failures without hammering the free services or
 * looping forever.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->unsignedTinyInteger('geo_attempts')->default(0)->after('geo_synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn('geo_attempts');
        });
    }
};
