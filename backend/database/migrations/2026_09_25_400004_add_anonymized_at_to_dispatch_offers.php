<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks offers whose personal data was stripped by the retention job / a driver
 * erasure, so a run never re-processes them. A trailing nullable column: MySQL 8
 * adds it INSTANT (metadata only, no table rebuild) on the hot offers table.
 * Idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('dispatch_offers', 'anonymized_at')) {
            return;
        }

        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->timestamp('anonymized_at')->nullable();
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('dispatch_offers', 'anonymized_at')) {
            Schema::table('dispatch_offers', function (Blueprint $table) {
                $table->dropColumn('anonymized_at');
            });
        }
    }
};
