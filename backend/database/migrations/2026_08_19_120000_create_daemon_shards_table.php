<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Daemon shards: each dispatch-daemon box registers itself here by name and
 * heartbeats on every poll. Fleet sessions are assigned to a shard so the
 * daemon only holds streams for the companies it owns — letting the fleet be
 * split across many boxes, with live company counts and admin control.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('daemon_shards', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();      // stable box identity (SHARD_ID env), e.g. "main", "shard-2"
            $table->string('label')->nullable();   // human note (region / box)
            $table->boolean('active')->default(true); // admin can drain a shard by turning this off
            $table->timestamp('last_seen_at')->nullable(); // last heartbeat — liveness
            $table->timestamps();
        });

        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            // Which shard holds this company's streams (null = unassigned yet).
            $table->foreignId('shard_id')->nullable()->after('status')
                ->constrained('daemon_shards')->nullOnDelete();
            $table->index('shard_id');
        });
    }

    public function down(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('shard_id');
        });
        Schema::dropIfExists('daemon_shards');
    }
};
