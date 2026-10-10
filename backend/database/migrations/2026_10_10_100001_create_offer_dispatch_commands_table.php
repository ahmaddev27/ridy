<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per dispatch-side action a driver (or a manager) asked us to send to
 * Uber for an offer. This is the ONLY place the product writes to Uber, and the
 * row is both the work item and its audit trail.
 *
 * The daemon holds the live vsdispatch cookie jar and the company's residential
 * proxy, so it — not the backend — performs the mutation. It learns about a row
 * through a long-poll it parks in advance, then reports Uber's verdict back here.
 *
 * Uber's offer window is 5 seconds (measured: 5 on all of 1003 real offers), so
 * the whole mutation payload is snapshotted at queue time. The daemon needs no
 * lookup, no JSON decode and nothing that can go stale while the clock runs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offer_dispatch_commands', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('dispatch_offer_id')->constrained()->cascadeOnDelete();
            // The session whose live jar must carry the mutation. Which daemon box
            // owns it is resolved through uber_fleet_sessions.shard_id, so a command
            // is never handed to the wrong shard.
            $table->foreignId('uber_fleet_session_id')->nullable()->constrained()->nullOnDelete();

            // 'reject' is the only action anything creates. 'accept' is accepted by
            // the daemon's executor so enabling it later needs no schema change, and
            // is deliberately unreachable today: no route, no UI, and the service
            // refuses to write it.
            $table->string('action', 8)->default('reject');

            // Who asked. Exactly one of the two is set.
            $table->foreignId('driver_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();

            // The mutation's params, frozen at queue time.
            $table->string('offer_uuid', 64);
            $table->string('real_offer_uuid', 64)->nullable();
            $table->string('offer_type', 32)->default('JOB');
            $table->string('driver_uuid', 64);

            // queued -> claimed -> succeeded | failed, or expired when no daemon
            // claimed it before the window closed.
            $table->string('status', 12)->default('queued')->index();
            // How many times we have handed this to a daemon. A failed attempt may
            // be re-queued by a second tap; this keeps that bounded and visible.
            $table->unsignedTinyInteger('attempts')->default(0);

            // Uber's own verdict, from offerResponse[0]. NULL until the daemon
            // reports. Only `true` may move the offer to rejected — a false must
            // leave it pending, or the dashboard would show a decline that Uber
            // never accepted and the inferred-accept path would go incoherent.
            $table->boolean('uber_success')->nullable();
            $table->string('uber_error')->nullable();

            // offer_generated_at -> Uber's response, in ms. The number that says
            // whether a human tap can beat Uber's window at all; RidyLog is a no-op
            // in production, so this column is the measurement.
            $table->unsignedInteger('latency_ms')->nullable();

            $table->timestamp('expires_at');
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            // A double tap, a retried POST, and two devices of the same driver must
            // all collapse onto one command rather than firing Uber twice.
            $table->unique(['dispatch_offer_id', 'action']);
            // The daemon's claim query: queued work that has not expired yet.
            $table->index(['status', 'expires_at']);
            $table->index(['tenant_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offer_dispatch_commands');
    }
};
