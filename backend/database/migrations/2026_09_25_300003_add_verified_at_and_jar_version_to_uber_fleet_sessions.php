<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * uber_fleet_sessions (a few rows per company, additive columns):
 *
 *  - verified_at: set once the daemon proves the stored cookies can read the
 *    claimed Uber org (a successful Fleet Hub roster/status poll for it). Only a
 *    proven — or freshly active — claim blocks another company from connecting
 *    the same org, so a junk-cookie capture can no longer squat an org forever.
 *    Backfilled from last_event_at: a session that ever streamed is the org's
 *    real, long-standing owner.
 *  - jar_version: bumped by a capture whose cookie VALUES changed. The daemon
 *    echoes the version it streams with; a write from an older stream (its
 *    rotated cookies, or a 401 on the jar a reconnect just replaced) is refused
 *    instead of clobbering the fresh capture.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            if (! Schema::hasColumn('uber_fleet_sessions', 'verified_at')) {
                $table->timestamp('verified_at')->nullable();
            }
            if (! Schema::hasColumn('uber_fleet_sessions', 'jar_version')) {
                $table->unsignedInteger('jar_version')->default(1);
            }
        });

        DB::table('uber_fleet_sessions')
            ->whereNull('verified_at')
            ->whereNotNull('last_event_at')
            ->update(['verified_at' => DB::raw('last_event_at')]);
    }

    public function down(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->dropColumn(['verified_at', 'jar_version']);
        });
    }
};
