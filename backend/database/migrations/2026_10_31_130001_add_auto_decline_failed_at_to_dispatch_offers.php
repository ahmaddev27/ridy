<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks an auto-declined offer whose dispatch decline ultimately failed or expired,
 * so the push we suppressed was sent belatedly instead. Doubles as the idempotency
 * guard (the fallback fires once) and keeps the offer out of the Early-decline
 * history, which must only list declines that really happened.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->timestamp('auto_decline_failed_at')->nullable()->after('auto_decline_reason');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', fn (Blueprint $table) => $table->dropColumn('auto_decline_failed_at'));
    }
};
