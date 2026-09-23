<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Index accepted_at so scopeTaken() (whereNotNull('accepted_at')) on the offers
 * stats page is served from an index instead of scanning the volume-heavy table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->index('accepted_at');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['accepted_at']);
        });
    }
};
