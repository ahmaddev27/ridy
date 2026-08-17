<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Enforce one Uber account = one company at the database level: a given
 * uber_org_uuid may back exactly one fleet session. This is the race-proof
 * backstop for the application-level capture guard, and it also cleans up any
 * legacy duplicate sessions (two companies that linked the same account before
 * the guard existed) by keeping only the most recently active one.
 */
return new class extends Migration
{
    public function up(): void
    {
        $orgs = DB::table('uber_fleet_sessions')
            ->select('uber_org_uuid')
            ->groupBy('uber_org_uuid')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('uber_org_uuid');

        foreach ($orgs as $org) {
            $keepId = DB::table('uber_fleet_sessions')
                ->where('uber_org_uuid', $org)
                ->orderByRaw('COALESCE(last_event_at, updated_at) DESC')
                ->value('id');

            DB::table('uber_fleet_sessions')
                ->where('uber_org_uuid', $org)
                ->where('id', '!=', $keepId)
                ->delete();
        }

        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->unique('uber_org_uuid');
        });
    }

    public function down(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->dropUnique(['uber_org_uuid']);
        });
    }
};
