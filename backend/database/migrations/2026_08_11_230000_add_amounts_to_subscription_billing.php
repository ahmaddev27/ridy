<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Give subscription invoices a real amount + paid/unpaid status. The admin enters
 * the amount (and whether it's already paid) when generating the activation code;
 * those pending values ride on the tenant until the company activates, when the
 * invoice is created. An unpaid invoice is settled later by linking the collector
 * payment that covers it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->decimal('activation_amount', 12, 2)->nullable()->after('activation_days');
            $table->boolean('activation_paid')->default(false)->after('activation_amount');
        });

        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->decimal('amount', 12, 2)->nullable()->after('days');
            $table->timestamp('paid_at')->nullable()->after('amount');
            $table->foreignId('collector_payment_id')->nullable()->after('paid_at')
                ->constrained('collector_payments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('subscription_periods', function (Blueprint $table) {
            $table->dropConstrainedForeignId('collector_payment_id');
            $table->dropColumn(['amount', 'paid_at']);
        });
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn(['activation_amount', 'activation_paid']);
        });
    }
};
