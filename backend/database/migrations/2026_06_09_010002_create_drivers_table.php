<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('drivers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tenant_id')->index();
            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('license_no')->nullable();
            $table->string('employment_type')->default('employee');
            $table->json('external_ids')->nullable(); // {samsara: "...", uber: "...", bolt: "..."}
            $table->string('pseudonym_id')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'phone']);
            $table->index(['tenant_id', 'license_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('drivers');
    }
};
