<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A human-readable, per-company payment reference on each issued activation code,
 * e.g. "DIN-2026-0042" — so a bank transfer can be reconciled back to the company
 * and the code ↔ subscription ↔ invoice chain is traceable. Unique; nullable for
 * historical rows issued before this feature.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscription_codes', function (Blueprint $table) {
            $table->string('payment_ref', 32)->nullable()->unique()->after('code');
        });
    }

    public function down(): void
    {
        Schema::table('subscription_codes', function (Blueprint $table) {
            $table->dropUnique(['payment_ref']);
            $table->dropColumn('payment_ref');
        });
    }
};
