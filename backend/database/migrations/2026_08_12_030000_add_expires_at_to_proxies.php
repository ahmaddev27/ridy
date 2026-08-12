<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When OUR subscription to a residential proxy ends. The admin dashboard alerts
 * five days before so a proxy is renewed before companies lose their exit IP.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->date('expires_at')->nullable()->after('capacity');
        });
    }

    public function down(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->dropColumn('expires_at');
        });
    }
};
