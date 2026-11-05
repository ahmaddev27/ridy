<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            // Study data (docs/address-resolution-plan.md, Phase A + C), all nullable:
            // the driver's position at receipt (4 decimals, ~11 m) and the ride they
            // were still on. Cleared by OfferAnonymizer at the retention cutoff.
            $table->decimal('receipt_driver_lat', 8, 4)->nullable();
            $table->decimal('receipt_driver_lng', 8, 4)->nullable();
            $table->dateTime('receipt_driver_fix_at')->nullable();
            $table->string('receipt_driver_status', 32)->nullable();
            $table->decimal('receipt_driver_heading', 5, 2)->nullable();
            // Plain indexed column, not a FK: offers get anonymized/purged.
            $table->unsignedBigInteger('chained_after_offer_id')->nullable()->index();
            $table->json('chain_context')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['chained_after_offer_id']);
            $table->dropColumn([
                'receipt_driver_lat', 'receipt_driver_lng', 'receipt_driver_fix_at', 'receipt_driver_status',
                'receipt_driver_heading', 'chained_after_offer_id', 'chain_context',
            ]);
        });
    }
};
