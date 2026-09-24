<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two tenant-scoped indexes on dispatch_offers (additive; MySQL 8 builds them
 * online, INPLACE / LOCK=NONE):
 *
 *  - (tenant_id, driver_id, driver_uuid): the dashboard's "unlinked offers" count
 *    (tenant_id = ? AND driver_id IS NULL, polled every 10 s), the unlinked-driver
 *    worklist GROUP BY driver_uuid, and the roster/linker backfill that finds a
 *    UUID's orphan offers — all answered from the index alone instead of walking
 *    the tenant's whole offer history.
 *  - (tenant_id, received_at, status, accepted_at, fare_amount): covers the offers
 *    page's single conditional-aggregate stats query (total / taken / completed /
 *    earnings over a date window), so it never reads full rows.
 */
return new class extends Migration
{
    private const DRIVER_IDX = 'dispatch_offers_tenant_driver_uuid_idx';

    private const STATS_IDX = 'dispatch_offers_tenant_stats_idx';

    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            if (! Schema::hasIndex('dispatch_offers', self::DRIVER_IDX)) {
                $table->index(['tenant_id', 'driver_id', 'driver_uuid'], self::DRIVER_IDX);
            }
            if (! Schema::hasIndex('dispatch_offers', self::STATS_IDX)) {
                $table->index(['tenant_id', 'received_at', 'status', 'accepted_at', 'fare_amount'], self::STATS_IDX);
            }
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(self::DRIVER_IDX);
            $table->dropIndex(self::STATS_IDX);
        });
    }
};
