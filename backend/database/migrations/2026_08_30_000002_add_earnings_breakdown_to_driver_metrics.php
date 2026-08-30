<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Richer earnings captured from Uber's getEarnerBreakdownsV2 (the Fleet Earnings
 * page): total distance, net outstanding, and the full category breakdown
 * (fare / promotion / tip / service fee / cash collected).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('driver_metrics', function (Blueprint $table) {
            $table->decimal('distance_km', 10, 2)->nullable()->after('trips');
            $table->decimal('net_outstanding', 12, 2)->nullable()->after('earnings');
            $table->json('breakdown')->nullable()->after('cancellation_rate');
        });
    }

    public function down(): void
    {
        Schema::table('driver_metrics', function (Blueprint $table) {
            $table->dropColumn(['distance_km', 'net_outstanding', 'breakdown']);
        });
    }
};
