<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A pool of residential proxies shared across companies. Each proxy holds up to
 * `capacity` active companies; a new company is auto-assigned the least-loaded
 * proxy that still has a free slot. A company that is deleted, disabled or
 * expired stops counting, freeing its slot for another.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('proxies', function (Blueprint $table) {
            $table->id();
            $table->string('label');
            $table->string('url', 1000);          // holds credentials — never exposed raw in lists
            $table->unsignedSmallInteger('capacity')->default(10);
            $table->string('notes')->nullable();
            $table->timestamps();
        });

        Schema::table('tenants', function (Blueprint $table) {
            $table->foreignId('proxy_id')->nullable()->after('proxy_url')->constrained('proxies')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropConstrainedForeignId('proxy_id');
        });
        Schema::dropIfExists('proxies');
    }
};
