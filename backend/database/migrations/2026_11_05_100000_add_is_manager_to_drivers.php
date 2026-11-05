<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A company admin who is also a driver, marked from the dashboard so their
        // driver app runs with manager features. Not mass-assignable: set via forceFill.
        Schema::table('drivers', function (Blueprint $table) {
            $table->boolean('is_manager')->default(false)->after('auto_decline');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn('is_manager');
        });
    }
};
