<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track which reseller (collector) issued a subscription. The pending value rides
 * on the tenant from code generation until activation, when it is copied onto the
 * invoice — so the reseller's later cash payment can settle the invoice they sold.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->foreignId('activation_collector_id')->nullable()->after('activation_paid')->constrained('collectors')->nullOnDelete();
        });

        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->foreignId('sold_by_collector_id')->nullable()->after('collector_payment_id')->constrained('collectors')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->dropConstrainedForeignId('sold_by_collector_id');
        });
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropConstrainedForeignId('activation_collector_id');
        });
    }
};
