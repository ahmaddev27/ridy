<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ads become image-only per device: the admin designs and uploads a mobile,
 * tablet and desktop image (each with its own baked-in call to action), and the
 * whole image is the click target. The legacy single image_url + cta_label stay
 * for old rows but are no longer authored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ads', function (Blueprint $table) {
            $table->string('image_mobile', 2048)->nullable()->after('image_url');
            $table->string('image_tablet', 2048)->nullable()->after('image_mobile');
            $table->string('image_desktop', 2048)->nullable()->after('image_tablet');
        });
    }

    public function down(): void
    {
        Schema::table('ads', function (Blueprint $table) {
            $table->dropColumn(['image_mobile', 'image_tablet', 'image_desktop']);
        });
    }
};
