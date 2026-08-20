<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A device token now belongs to EITHER a driver (the driver app) OR a fleet
     * owner/manager (the same app, monitoring the whole fleet). Owner devices
     * receive a copy of every one of their drivers' offer pushes.
     */
    public function up(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->after('tenant_id')->index();
            $table->unsignedBigInteger('driver_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('device_tokens', function (Blueprint $table) {
            $table->dropIndex(['user_id']);
            $table->dropColumn('user_id');
            $table->unsignedBigInteger('driver_id')->nullable(false)->change();
        });
    }
};
