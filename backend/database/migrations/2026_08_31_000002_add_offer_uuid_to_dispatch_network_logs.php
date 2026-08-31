<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Promote the offer's UUID to a real indexed column on the network-log feed. The
 * cross-path offer de-duplication previously scanned the JSON `payload->offerUUID`
 * on every ingest (no generated-column index); a plain indexed column makes that
 * lookup a cheap index seek as the volume-heavy table grows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_network_logs', function (Blueprint $table) {
            $table->string('offer_uuid', 64)->nullable()->after('kind');
            $table->index(['tenant_id', 'kind', 'offer_uuid', 'created_at'], 'dnl_offer_dedup_idx');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_network_logs', function (Blueprint $table) {
            $table->dropIndex('dnl_offer_dedup_idx');
            $table->dropColumn('offer_uuid');
        });
    }
};
