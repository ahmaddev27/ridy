<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-driver performance metrics captured from Uber's supplier GetEarnerMetrics
 * (earnings, trips, online/on-trip hours, acceptance/cancellation rates) for a
 * given time window. One row per driver + window (upserted on re-sync).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_metrics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();
            $table->timestamp('period_start');
            $table->timestamp('period_end');
            $table->decimal('earnings', 12, 2)->nullable();
            $table->string('earnings_label')->nullable(); // currency, e.g. "€"
            $table->unsignedInteger('trips')->nullable();
            $table->decimal('hours_online', 8, 2)->nullable();
            $table->decimal('hours_on_trip', 8, 2)->nullable();
            $table->decimal('acceptance_rate', 5, 2)->nullable(); // 0..1 or 0..100 as sent
            $table->decimal('cancellation_rate', 5, 2)->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['driver_id', 'period_start', 'period_end']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_metrics');
    }
};
