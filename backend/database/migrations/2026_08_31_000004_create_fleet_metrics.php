<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The whole fleet's official Uber earnings summary, captured from the Fleet
 * Earnings page (getSupplierBreakdownV2) — one latest snapshot per company. The
 * per-driver figures live in driver_metrics; this is the company-level roll-up
 * (total earnings, cash collected, net payout).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fleet_metrics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete()->unique();
            $table->decimal('earnings', 12, 2)->nullable();
            $table->decimal('net_outstanding', 12, 2)->nullable(); // end balance (paid out)
            $table->decimal('cash_collected', 12, 2)->nullable();   // cash the drivers hold
            $table->decimal('fare', 12, 2)->nullable();
            $table->string('currency', 8)->nullable();
            $table->json('breakdown')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fleet_metrics');
    }
};
