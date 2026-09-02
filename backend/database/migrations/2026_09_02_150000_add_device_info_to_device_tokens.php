<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Capture the human device model + OS version for each installed app
     * instance, gathered client-side via expo-device. Both are nullable: older
     * app builds don't send them, and web/legacy registrations never will.
     */
    public function up(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->string('device_name', 120)->nullable()->after('platform'); // e.g. "iPhone 14 Pro", "Pixel 7"
            $table->string('os_version', 40)->nullable()->after('device_name'); // e.g. "17.1", "14"
        });
    }

    public function down(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->dropColumn(['device_name', 'os_version']);
        });
    }
};
