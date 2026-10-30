<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How long the backend's own hot path took, per offer: received_at (ingest start)
 * → the FCM push handoff. Persisted so the latency can be read as a distribution
 * in prod (p50/p95), where the former RidyLog metric is a no-op. The daemon leg
 * (SSE receipt → this POST) is logged daemon-side; Uber → received is
 * offer_generated_at → received_at on the row already.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table): void {
            $table->unsignedInteger('notify_latency_ms')->nullable()->after('received_at');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table): void {
            $table->dropColumn('notify_latency_ms');
        });
    }
};
