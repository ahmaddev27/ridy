<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Fleet-owner app tokens used to be minted with '*' abilities, so an emailed
 * 6-digit code granted the full manager API. They are now minted read-only
 * (`fleet:read`, name `driver-app-owner`) and confined by EnsureDashboardToken.
 *
 * Revoke the already-issued unscoped ones — they would keep their full power
 * until the owner happened to log out. Owners simply sign in again and get a
 * scoped token. Drivers are unaffected (their tokens are on the Driver model).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('name', 'driver-app')
            ->delete();
    }

    public function down(): void
    {
        // Deleted credentials cannot be restored — and must not be.
    }
};
