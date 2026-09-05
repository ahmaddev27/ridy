<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The proxy's base subscription period now has a start date too (it already had
 * an end, `expires_at`), so the admin sees the full "start → end" span. Renewals
 * that extend it live in the separate `proxy_renewals` table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->date('starts_at')->nullable()->after('source');
        });
    }

    public function down(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->dropColumn('starts_at');
        });
    }
};
