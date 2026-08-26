<?php

use App\Domain\Geo\PostalCodes;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Populates the postal_codes table from the committed CSV so production is seeded
 * by `migrate --force` on deploy (the DatabaseSeeder, which also creates demo
 * users, is never run there). Idempotent — the importer upserts on the plz key.
 */
return new class extends Migration
{
    public function up(): void
    {
        PostalCodes::import();
    }

    public function down(): void
    {
        DB::table('postal_codes')->truncate();
    }
};
