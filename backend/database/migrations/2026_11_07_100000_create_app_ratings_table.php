<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            // One row per driver (unique): a later rating replaces the earlier one.
            $table->foreignId('driver_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('stars');
            $table->text('feedback')->nullable();
            $table->string('platform', 10);
            $table->string('app_version', 20)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'driver_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_ratings');
    }
};
