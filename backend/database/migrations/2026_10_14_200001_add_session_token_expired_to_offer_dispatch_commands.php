<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('offer_dispatch_commands', function (Blueprint $table) {
            // Was the session's `jwt-session` (RAMEN jar, the jar RejectOffers is sent
            // with) already past its stored expiry when the command was queued? NULL
            // means no stored expiry = UNKNOWN, never "fine". Evidence only: nothing
            // is blocked or retried differently because of it. It answers whether an
            // expired jwt-session breaks the one write we make to Uber:
            //   SELECT session_token_expired, uber_success, COUNT(*)
            //   FROM offer_dispatch_commands WHERE uber_success IS NOT NULL
            //   GROUP BY session_token_expired, uber_success;
            $table->boolean('session_token_expired')->nullable()->after('attempts');
        });
    }

    public function down(): void
    {
        Schema::table('offer_dispatch_commands', function (Blueprint $table) {
            $table->dropColumn('session_token_expired');
        });
    }
};
