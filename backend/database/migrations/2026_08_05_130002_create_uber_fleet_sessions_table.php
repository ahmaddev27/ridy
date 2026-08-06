<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('uber_fleet_sessions', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();

            // The fleet this session belongs to (getUser uuid = partnerUUID).
            $table->string('uber_org_uuid')->index();

            // Captured browser session the Node daemon uses to open the RAMEN
            // stream. Encrypted at rest; never exposed via any resource.
            $table->text('cookies'); // encrypted:array
            $table->timestamp('expires_at')->nullable();

            // active | expired | needs_relink — drives whether the daemon runs and
            // whether the manager is prompted to reconnect.
            $table->string('status')->default('active')->index();

            // Last time an offer/heartbeat was seen — liveness signal for the daemon.
            $table->timestamp('last_event_at')->nullable();

            $table->timestamps();

            $table->unique(['tenant_id', 'uber_org_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('uber_fleet_sessions');
    }
};
