<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per subscription activation/renewal — the "invoice" for a paid period.
 * Generated automatically when a company consumes an activation code. The money
 * itself lives in collector_payments (the cash companies hand to collectors), so
 * this table records the period, not an amount.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_periods', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->unsignedInteger('days');
            $table->timestamp('starts_at');
            $table->timestamp('ends_at');
            $table->timestamps();

            $table->index(['tenant_id', 'starts_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_periods');
    }
};
