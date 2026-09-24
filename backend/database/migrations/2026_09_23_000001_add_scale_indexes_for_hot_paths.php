<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes for hot, unindexed predicates surfaced by the DB scale audit — each
 * turned a frequent query into a full-table scan:
 *  - drivers(tenant_id, status_synced_at): fleet:check-sync + fleet:check-offer-flow
 *    (both every 5 min, per tenant) and the live-map poll filter on status_synced_at.
 *  - dispatch_network_logs(created_at): the hourly prune deletes by created_at with
 *    no leading-column index (the table's indexes all lead with tenant_id), so it
 *    scanned the highest-volume table every hour.
 *  - dispatch_offers(geo_synced_at, received_at): offers:backfill-geo (every 10 min)
 *    scans for geo_synced_at IS NULL ordered by received_at — this serves both the
 *    NULL filter and the order (no scan, no filesort).
 * Added online (MySQL 8 INPLACE), no table lock on deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Guarded: MySQL DDL is not transactional, so a failure on the 3rd ALTER left
        // the first two in place and every re-run died on "Duplicate key name".
        if (! Schema::hasIndex('drivers', ['tenant_id', 'status_synced_at'])) {
            Schema::table('drivers', function (Blueprint $table) {
                $table->index(['tenant_id', 'status_synced_at']);
            });
        }
        if (! Schema::hasIndex('dispatch_network_logs', ['created_at'])) {
            Schema::table('dispatch_network_logs', function (Blueprint $table) {
                $table->index('created_at');
            });
        }
        if (! Schema::hasIndex('dispatch_offers', ['geo_synced_at', 'received_at'])) {
            Schema::table('dispatch_offers', function (Blueprint $table) {
                $table->index(['geo_synced_at', 'received_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'status_synced_at']);
        });
        Schema::table('dispatch_network_logs', function (Blueprint $table) {
            $table->dropIndex(['created_at']);
        });
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['geo_synced_at', 'received_at']);
        });
    }
};
