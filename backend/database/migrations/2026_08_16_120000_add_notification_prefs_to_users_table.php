<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user channel opt-outs for bell notifications. The in-app bell is always on;
 * this stores only the web-push and email toggles the user has turned OFF.
 * Shape: { "email": {"<category>": bool}, "push": {"<category>": bool} }.
 * A missing category means the channel is ON (opt-out defaults).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('notification_prefs')->nullable()->after('locale');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('notification_prefs');
        });
    }
};
