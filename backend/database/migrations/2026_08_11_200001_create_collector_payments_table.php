<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A single cash payment: which fleet (tenant) paid, which collector received it,
 * how much, and when. There is no fixed fleet→collector link — the same fleet
 * may pay one collector this month and another next month — so the collector is
 * recorded here per payment. Entered manually by the super-admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('collector_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('collector_id')->constrained('collectors')->cascadeOnDelete();
            // The fleet that paid. Cascade so a deleted company takes its ledger with it.
            $table->foreignId('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->date('paid_on');
            $table->string('note')->nullable();
            // The admin who recorded it (kept for audit); null if that user is removed.
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['collector_id', 'paid_on']);
            $table->index(['tenant_id', 'paid_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('collector_payments');
    }
};
