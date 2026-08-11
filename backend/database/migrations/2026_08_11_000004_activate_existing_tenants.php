<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Grandfather companies that existed before activation was required: mark any
 * active tenant that was never activated as activated now, so they stay usable.
 * New signups (created after this) start with activated_at NULL → they must
 * enter an activation code.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('tenants')
            ->where('status', 'active')
            ->whereNull('activated_at')
            ->update(['activated_at' => now()]);
    }

    public function down(): void
    {
        // No-op: we can't tell which tenants were backfilled.
    }
};
