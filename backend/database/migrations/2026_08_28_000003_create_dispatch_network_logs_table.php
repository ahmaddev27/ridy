<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every inbound dispatch request captured from the supplier (Uber) — offers,
 * driver status/location syncs, roster pulls — so the super-admin's Network tab
 * can show literally everything that came over the wire per company, with the
 * exact payload. Volume-heavy (status syncs are frequent), so rows are pruned
 * after a short retention window (see PruneNetworkLogs).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispatch_network_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->nullable();
            $table->string('kind', 20);            // offer | status | roster
            $table->string('summary')->nullable(); // short human line for the list
            $table->unsignedInteger('count')->nullable(); // items in a batch (statuses/offers)
            $table->json('payload');               // the raw captured request
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'kind', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispatch_network_logs');
    }
};
