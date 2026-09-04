<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A human-readable, per-year sequential invoice number on each paid period, e.g.
 * "RE-2026-0042". Nullable so pre-existing periods (and free grants) keep no
 * number; the PDF endpoint synthesises a fallback when it is absent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->string('invoice_no')->nullable()->unique()->after('id');
        });
    }

    public function down(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->dropUnique(['invoice_no']);
            $table->dropColumn('invoice_no');
        });
    }
};
