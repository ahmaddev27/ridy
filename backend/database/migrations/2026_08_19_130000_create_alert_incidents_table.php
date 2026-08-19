<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Open/close ledger for operational alerts (a fleet session needing relink, a
 * daemon shard going down, …). One row per distinct incident `key`; it is
 * opened (and emailed) once and resolved when the condition clears, so ops get
 * a single alert per incident instead of a flood.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('alert_incidents', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();   // stable per-incident id, e.g. "shard_down:3"
            $table->string('kind');            // grouping: shard_down | session_relink | …
            $table->string('title');
            $table->timestamp('opened_at');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
            $table->index(['kind', 'resolved_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('alert_incidents');
    }
};
