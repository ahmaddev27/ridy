<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track what each proxy costs and where it was bought, so the admin can see the
 * running spend on the residential-proxy pool.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->decimal('price', 10, 2)->nullable()->after('capacity');
            $table->string('source')->nullable()->after('price');
        });
    }

    public function down(): void
    {
        Schema::table('proxies', function (Blueprint $table) {
            $table->dropColumn(['price', 'source']);
        });
    }
};
