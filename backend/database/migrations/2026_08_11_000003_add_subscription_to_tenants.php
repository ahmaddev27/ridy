<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Subscription + activation lifecycle for companies. A company is usable only
 * while active, not banned, and (if a subscription end is set) not expired. The
 * admin generates a short-lived activation code the owner enters; three wrong
 * entries ban the account until an admin reactivates it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->timestamp('activated_at')->nullable()->after('status');
            $table->timestamp('subscription_ends_at')->nullable()->after('activated_at');
            $table->timestamp('banned_at')->nullable()->after('subscription_ends_at');

            // Pending activation the owner must confirm (code valid ~2 minutes).
            $table->string('activation_code', 6)->nullable()->after('banned_at');
            $table->timestamp('activation_code_expires_at')->nullable()->after('activation_code');
            $table->unsignedSmallInteger('activation_days')->nullable()->after('activation_code_expires_at');
            $table->unsignedTinyInteger('activation_attempts')->default(0)->after('activation_days');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('phone')->nullable()->after('email');
        });

        Schema::table('registrations', function (Blueprint $table) {
            $table->string('phone')->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn([
                'activated_at', 'subscription_ends_at', 'banned_at',
                'activation_code', 'activation_code_expires_at', 'activation_days', 'activation_attempts',
            ]);
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('phone');
        });
        Schema::table('registrations', function (Blueprint $table) {
            $table->dropColumn('phone');
        });
    }
};
