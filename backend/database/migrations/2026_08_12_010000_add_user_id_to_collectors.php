<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Optionally give a collector a login (a reseller User) so they can sign in and
 * issue activation codes. The link is nullable — a collector can exist purely as
 * a cash-ledger record without a login.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('collectors', function (Blueprint $table) {
            $table->foreignId('user_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('collectors', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_id');
        });
    }
};
