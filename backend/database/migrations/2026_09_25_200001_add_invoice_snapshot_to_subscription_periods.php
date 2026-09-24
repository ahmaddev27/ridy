<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Makes an issued invoice immutable (GoBD): `issued_at` is the fixed issue date
 * (settling later only sets paid_at), `invoice_snapshot` freezes the issuer/VAT
 * settings and the customer block as they were at issue, and `canceled_at`
 * lets "end subscription" cancel a period instead of deleting a numbered,
 * emailed invoice. All nullable + additive: legacy rows keep rendering live.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->dateTime('issued_at')->nullable();
            $table->json('invoice_snapshot')->nullable();
            $table->dateTime('canceled_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->dropColumn(['issued_at', 'invoice_snapshot', 'canceled_at']);
        });
    }
};
