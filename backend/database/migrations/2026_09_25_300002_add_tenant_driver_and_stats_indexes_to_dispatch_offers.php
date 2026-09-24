<?php

use App\Support\OnlineDdl;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * Two tenant-scoped indexes on dispatch_offers (additive; built online through
 * {@see OnlineDdl}: INPLACE / LOCK=NONE with a 10 s metadata-lock wait, so a slow
 * reader makes the migration fail fast instead of queueing offer ingest behind it):
 *
 *  - (tenant_id, driver_id, driver_uuid): the dashboard's "unlinked offers" count
 *    (tenant_id = ? AND driver_id IS NULL, polled every 10 s), the unlinked-driver
 *    worklist GROUP BY driver_uuid, and the roster/linker backfill that finds a
 *    UUID's orphan offers — all answered from the index alone instead of walking
 *    the tenant's whole offer history.
 *  - (tenant_id, received_at, status, accepted_at, fare_amount): covers the offers
 *    page's single conditional-aggregate stats query (total / taken / completed /
 *    earnings over a date window), so it never reads full rows.
 *
 * Idempotent: a deploy that hit the lock timeout can simply run again.
 */
return new class extends Migration
{
    private const TABLE = 'dispatch_offers';

    private const INDEXES = [
        'dispatch_offers_tenant_driver_uuid_idx' => ['tenant_id', 'driver_id', 'driver_uuid'],
        'dispatch_offers_tenant_stats_idx' => ['tenant_id', 'received_at', 'status', 'accepted_at', 'fare_amount'],
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $name => $columns) {
            if (! Schema::hasIndex(self::TABLE, $name)) {
                OnlineDdl::addIndex(self::TABLE, $name, $columns);
            }
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::INDEXES) as $name) {
            if (Schema::hasIndex(self::TABLE, $name)) {
                OnlineDdl::dropIndex(self::TABLE, $name);
            }
        }
    }
};
