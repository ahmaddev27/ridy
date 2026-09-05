<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a driver went offline (null while online). Lets the offer lifecycle tell a
 * genuine sign-off/end-of-trip from a brief mid-trip connection blip: a STARTED
 * trip is only finalized once the driver has been continuously offline past a
 * short grace, so a driver whose internet drops for a moment — then returns to
 * ON_TRIP — keeps their live trip instead of it being closed early.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->timestamp('went_offline_at')->nullable()->after('online_status');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn('went_offline_at');
        });
    }
};
