<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The driver app's queries (DriverDashboardController::home, OfferLifecycle::
 * activeOfferFor / pendingOfferFor) all filter by a driver key and ORDER BY
 * received_at, but no index paired a driver key with received_at — so MySQL had
 * to filesort, and because each row carries the large `raw_payload` JSON the sort
 * rows were huge. Once a driver accumulated enough offers the sort ran out of
 * memory (SQLSTATE[HY001] 1038 "Out of sort memory"), 500ing /driver/home and
 * /driver/offers so the app read the driver Offline with no offers.
 *
 * These composite indexes let the ORDER BY received_at be served straight from the
 * index (no filesort), which removes the 1038 entirely and speeds the lookups.
 * Added online (MySQL 8 INPLACE) so it does not lock the table on deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->index(['driver_id', 'received_at']);
            $table->index(['driver_uuid', 'received_at']);
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['driver_id', 'received_at']);
            $table->dropIndex(['driver_uuid', 'received_at']);
        });
    }
};
