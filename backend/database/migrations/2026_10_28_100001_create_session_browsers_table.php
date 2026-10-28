<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-company telemetry of the persistent Uber-session browser service. Token
 * expiries are deliberately NOT duplicated here: they live on uber_fleet_sessions.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('session_browsers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->unique();
            $table->string('state', 16)->default('not_set_up');
            $table->timestamp('last_login_at')->nullable();
            $table->timestamp('last_capture_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->unsignedInteger('hard_reauth_count')->default(0);
            $table->unsignedInteger('consecutive_errors')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('session_browsers');
    }
};
