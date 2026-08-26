<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A static German postal-code table (plz → city + centroid). The safety net for
 * address resolution: any offer carrying a valid PLZ can always resolve to at
 * least the town centre, so distance and €/km are never blank. Seeded from
 * database/data/postal_codes.csv; see docs/address-resolution-plan.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('postal_codes', function (Blueprint $table) {
            $table->char('plz', 5)->primary();
            $table->string('city');
            $table->decimal('lat', 9, 6);
            $table->decimal('lng', 9, 6);
            $table->string('bundesland')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('postal_codes');
    }
};
