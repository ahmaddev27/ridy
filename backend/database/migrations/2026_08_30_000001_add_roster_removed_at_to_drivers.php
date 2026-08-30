<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a full Uber roster sync no longer lists a driver, we mark them removed
 * from the supplier fleet — never delete them. The row (and its offer history)
 * stays with the company; this timestamp records when Uber dropped them and
 * clears again if they reappear in a later sync.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->timestamp('roster_removed_at')->nullable()->after('roster_synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn('roster_removed_at');
        });
    }
};
