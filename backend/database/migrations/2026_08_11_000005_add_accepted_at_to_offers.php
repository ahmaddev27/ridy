<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks a dispatch offer as accepted by the driver. Set when a driver's Uber
 * status transitions to ON_TRIP shortly after the offer — the strongest signal
 * we can observe that they actually took it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->timestamp('accepted_at')->nullable()->after('received_at');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn('accepted_at');
        });
    }
};
