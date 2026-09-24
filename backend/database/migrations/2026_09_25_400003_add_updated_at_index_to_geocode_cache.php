<?php

use App\Support\OnlineDdl;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * geocode-cache:prune filters on updated_at, which had no index: each nightly
 * DELETE was a full scan holding next-key locks the live geocoder then waited on.
 * Added online (INPLACE, LOCK=NONE) on MySQL; idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasIndex('geocode_cache', 'geocode_cache_updated_at_index')) {
            return;
        }

        OnlineDdl::addIndex('geocode_cache', 'geocode_cache_updated_at_index', ['updated_at']);
    }

    public function down(): void
    {
        if (Schema::hasIndex('geocode_cache', 'geocode_cache_updated_at_index')) {
            OnlineDdl::dropIndex('geocode_cache', 'geocode_cache_updated_at_index');
        }
    }
};
