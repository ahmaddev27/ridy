<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per Uber session outage: opened when Uber rejects the session
 * (active → needs_relink), closed when the daemon's offer stream delivers again.
 * Measures how long companies go without offers and how each outage was fixed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fleet_session_outages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uber_fleet_session_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            // Who detected the break: daemon / extension / admin.
            $table->string('cause', 32);
            // How the last relink attempt arrived: auto (extension self-heal) / manual (Connect) / page.
            $table->string('recovered_via', 16)->nullable();
            $table->unsignedInteger('relink_attempts')->default(0);

            $table->index(['tenant_id', 'started_at']);
            $table->index(['uber_fleet_session_id', 'ended_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fleet_session_outages');
    }
};
