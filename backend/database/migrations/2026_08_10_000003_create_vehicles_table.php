<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fleet vehicles captured from Uber's supplier SearchVehicles query. One row per
 * vehicle, upserted on sync. `assigned_driver_uuid` links to a driver when Uber
 * reports an assignment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('uber_vehicle_uuid');
            $table->string('make')->nullable();
            $table->string('model')->nullable();
            $table->unsignedSmallInteger('year')->nullable();
            $table->string('license_plate')->nullable();
            $table->string('vin')->nullable();
            $table->string('color')->nullable();
            $table->string('color_hex', 9)->nullable();
            $table->text('image_url')->nullable();
            $table->string('compliance_status')->nullable();
            $table->string('assigned_driver_uuid')->nullable(); // Uber driver UUID
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'uber_vehicle_uuid']);
            $table->index(['tenant_id', 'assigned_driver_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};
