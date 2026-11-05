<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('offer_dispatch_commands', function (Blueprint $table) {
            // Marks a decline queued by the auto-decline engine (not a human tap), so the
            // claim step can re-verify the admin gate with a fresh read right before the
            // daemon is handed the command (docs/25).
            $table->boolean('is_auto')->default(false)->after('action');
        });
    }

    public function down(): void
    {
        Schema::table('offer_dispatch_commands', function (Blueprint $table) {
            $table->dropColumn('is_auto');
        });
    }
};
