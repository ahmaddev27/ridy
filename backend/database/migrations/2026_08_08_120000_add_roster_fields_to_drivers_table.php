<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Roster fields pulled from Uber's supplier /api/getDrivers — profile photo,
 * rating, lifetime trips and activity status, so the dashboard can show a rich
 * driver list without waiting for live offers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->text('uber_picture_url')->nullable()->after('uber_email');
            $table->decimal('uber_rating', 3, 2)->nullable()->after('uber_picture_url');
            $table->unsignedInteger('uber_total_trips')->nullable()->after('uber_rating');
            $table->string('uber_status')->nullable()->after('uber_total_trips'); // e.g. ONBOARDING_STATUS_ACTIVE
            $table->timestamp('roster_synced_at')->nullable()->after('uber_status');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn([
                'uber_picture_url', 'uber_rating', 'uber_total_trips', 'uber_status', 'roster_synced_at',
            ]);
        });
    }
};
