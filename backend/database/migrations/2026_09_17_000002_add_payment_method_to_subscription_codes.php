<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How the subscription behind each activation code was paid — 'bank' (transfer)
 * or 'cash', matching the payment methods the admin enables in settings. Kept as
 * a short string (not an enum) so a new method is a settings + i18n change, not a
 * schema migration. Nullable: free grants and legacy rows have no recorded method.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscription_codes', function (Blueprint $table) {
            $table->string('payment_method', 16)->nullable()->after('payment_ref');
        });
    }

    public function down(): void
    {
        Schema::table('subscription_codes', function (Blueprint $table) {
            $table->dropColumn('payment_method');
        });
    }
};
