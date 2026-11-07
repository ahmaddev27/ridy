<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Links a company owner's dashboard User to the Driver row that is the same
        // person ("owner who also drives"). Not mass-assignable: written via forceFill.
        // MySQL allows many NULLs, so the unique pair means one driver per user per tenant.
        Schema::table('drivers', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->after('is_manager');
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
            $table->unique(['tenant_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
            $table->dropUnique(['tenant_id', 'user_id']);
            $table->dropColumn('user_id');
        });
    }
};
