<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dispatch_offers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();

            // Routing key. The offer arrives before the driver may be linked, so
            // driver_id is nullable and backfilled once the link exists.
            $table->string('driver_uuid')->index();
            $table->unsignedBigInteger('driver_id')->nullable()->index();

            // Dedup key — the RAMEN stream repeats the same offer (confirmed in the
            // captured sample), so this must be unique per tenant.
            $table->string('offer_uuid');
            $table->string('real_offer_uuid')->nullable();
            $table->string('partner_uuid')->nullable();
            $table->unsignedBigInteger('seq')->nullable();

            // Full offer detail (product decision: store everything captured).
            $table->string('rider_first_name')->nullable();
            $table->string('driver_first_name')->nullable();
            $table->string('driver_last_name')->nullable();
            $table->text('pickup_address')->nullable();
            $table->text('dropoff_address')->nullable();
            $table->string('fare_formatted')->nullable();
            $table->unsignedInteger('accept_window_seconds')->nullable();

            $table->timestamp('requested_at')->nullable();
            $table->timestamp('offer_generated_at')->nullable();
            $table->timestamp('received_at');

            // The untouched event, so nothing captured is ever lost.
            $table->json('raw_payload');

            $table->timestamps();

            $table->unique(['tenant_id', 'offer_uuid']);
            $table->index(['tenant_id', 'received_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispatch_offers');
    }
};
