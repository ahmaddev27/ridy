<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Online" and "engagement" are decided from Uber's raw `online_status` with
 * leading-wildcard LIKE '%TOKEN%' comparisons, which can never use an index — the
 * scopeOnline()/scopeIdle() predicates and the per-tenant hot commands full-scan
 * the drivers table. These two generated columns let the DB compute the verdict
 * once so it can be indexed, with NO dual-write and NO drift: nothing writes them.
 *
 * VIRTUAL (not STORED) is required and deliberate: SQLite (the test engine) forbids
 * adding a STORED generated column via ALTER TABLE, while a VIRTUAL one adds cleanly;
 * on MySQL 8 a VIRTUAL column is an instant metadata-only add (no table rebuild), and
 * a secondary index still materializes the value, so the index scans stay fast.
 *
 * The CASE expressions below are a SQL transcription of Driver::OFFLINE_TOKENS and
 * Driver::engagementStatus() and MUST stay in lockstep with them — DriverOnlineParityTest
 * asserts the two agree on both engines, so it fails loudly if either side drifts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->unsignedTinyInteger('is_online')->virtualAs("CASE WHEN online_status IS NULL OR TRIM(online_status) = '' THEN 0 WHEN UPPER(online_status) LIKE '%OFFLINE%' THEN 0 WHEN UPPER(online_status) LIKE '%UNAVAILABLE%' THEN 0 WHEN UPPER(online_status) LIKE '%DISCONNECTED%' THEN 0 WHEN UPPER(online_status) LIKE '%OFF_DUTY%' THEN 0 WHEN UPPER(online_status) LIKE '%LOGGED_OUT%' THEN 0 ELSE 1 END");
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->unsignedTinyInteger('engagement')->virtualAs("CASE WHEN UPPER(online_status) LIKE '%ON_TRIP%' THEN 2 WHEN UPPER(online_status) LIKE '%EN_ROUTE%' THEN 1 ELSE 0 END");
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->index('is_online');
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->index('engagement');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropIndex(['is_online']);
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropIndex(['engagement']);
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['is_online', 'engagement']);
        });
    }
};
