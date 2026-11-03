<?php

use App\Domain\Fleet\Models\Driver;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Where a passkey may sign in: the web dashboard or the driver app. An app
 * passkey must never open the dashboard and a dashboard one never the app, so
 * the scope is part of every lookup. Existing rows: drivers only ever signed
 * into the app ('app'); users only ever into the dashboard (the default).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('webauthn_credentials', function (Blueprint $table) {
            $table->string('scope', 16)->default('dashboard')->index();
        });

        DB::table('webauthn_credentials')
            ->where('authenticatable_type', (new Driver)->getMorphClass())
            ->update(['scope' => 'app']);
    }

    public function down(): void
    {
        // Before the scope column disappears, drop the app-scoped passkeys that belong to a
        // dashboard User (the owner app passkeys). Without the column, scope-unaware code
        // would accept them at the dashboard login — an app->dashboard escalation on rollback.
        // Drivers keep theirs; they only ever sign into the app anyway.
        DB::table('webauthn_credentials')
            ->where('scope', 'app')
            ->where('authenticatable_type', '!=', (new Driver)->getMorphClass())
            ->delete();

        Schema::table('webauthn_credentials', function (Blueprint $table) {
            $table->dropIndex(['scope']);
            $table->dropColumn('scope');
        });
    }
};
