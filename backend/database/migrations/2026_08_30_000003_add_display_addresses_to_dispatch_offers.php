<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The supplier's address with ONLY a missing postcode filled in from the geocoded
 * result — and only when the geocoded town matches the raw one, so the city is
 * never changed. Displayed in preference to the raw text; null until enriched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->string('pickup_display')->nullable()->after('pickup_address');
            $table->string('dropoff_display')->nullable()->after('dropoff_address');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn(['pickup_display', 'dropoff_display']);
        });
    }
};
