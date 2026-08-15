<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Turns a Driver into an authenticatable identity for the mobile app: a login
 * email + password, an invitation token (manager invites by email), a UI locale,
 * and activity timestamps. All nullable so existing roster-synced drivers are
 * untouched until they are invited.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->string('email')->nullable()->unique()->after('phone');
            $table->string('password')->nullable()->after('email');
            $table->string('locale', 5)->default('de')->after('password');
            $table->string('invite_token', 64)->nullable()->unique()->after('locale');
            $table->timestamp('invited_at')->nullable()->after('invite_token');
            $table->timestamp('activated_at')->nullable()->after('invited_at');
            $table->timestamp('last_login_at')->nullable()->after('activated_at');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropUnique(['email']);
            $table->dropUnique(['invite_token']);
            $table->dropColumn([
                'email', 'password', 'locale', 'invite_token',
                'invited_at', 'activated_at', 'last_login_at',
            ]);
        });
    }
};
