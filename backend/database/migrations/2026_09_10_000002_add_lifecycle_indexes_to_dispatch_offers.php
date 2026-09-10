<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Composite indexes for the offer lifecycle's hottest lookups. dispatch_offers is
 * the fastest-growing table in the system and only carried single-column indexes,
 * so the three queries that run on EVERY driver status transition
 * (activeOfferFor / pendingOfferFor / nextTakeableOfferAfter — all
 * `tenant_id + driver_uuid` ordered by `received_at`) fell back to a filesort on
 * the driver_uuid index, degrading steadily as history accumulates. The pending
 * sweep (`offers:expire-pending`, per minute globally + every 15 s per tenant)
 * scans a low-cardinality `status` the same way.
 *
 * Cheap to add now, painful once the table is large.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->index(['tenant_id', 'driver_uuid', 'received_at']);
            $table->index(['tenant_id', 'status', 'received_at']);
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'driver_uuid', 'received_at']);
            $table->dropIndex(['tenant_id', 'status', 'received_at']);
        });
    }
};
