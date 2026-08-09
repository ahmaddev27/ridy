<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-company residential proxy. Each tenant streams Uber through its own static
 * residential IP so many fleets don't share one exit (which Uber would flag as a
 * bot farm). Null falls back to the daemon's global UBER_PROXY_URL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->text('proxy_url')->nullable()->after('uber_org_uuid');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn('proxy_url');
        });
    }
};
