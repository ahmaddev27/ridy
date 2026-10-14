<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When Uber's two signed session JWTs expire (`exp`, read from the cookie jars at
 * write time): `jwt-session` in the RAMEN jar and `sp-jwt-session` in the
 * supplier jar. Stored so the dashboard can show them and alerts:check can warn
 * before one lapses, without decrypting every jar on each run.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->timestamp('session_token_expires_at')->nullable();
            $table->timestamp('supplier_token_expires_at')->nullable();

            $table->index('session_token_expires_at');
            $table->index('supplier_token_expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('uber_fleet_sessions', function (Blueprint $table) {
            $table->dropIndex(['session_token_expires_at']);
            $table->dropIndex(['supplier_token_expires_at']);
            $table->dropColumn(['session_token_expires_at', 'supplier_token_expires_at']);
        });
    }
};
