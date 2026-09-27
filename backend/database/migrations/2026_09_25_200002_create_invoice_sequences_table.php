<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The per-(prefix, year) invoice counter. Numbers come from this row, not from
 * MAX(invoice_no) over periods, so a number is never reused even if a period row
 * disappears, and the sequence keeps counting past 9999. The row is seeded
 * lazily from existing invoice numbers on first use (InvoiceNumberGenerator).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_sequences', function (Blueprint $table) {
            $table->string('prefix', 32);
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_no')->default(0);
            $table->timestamps();

            $table->primary(['prefix', 'year']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_sequences');
    }
};
