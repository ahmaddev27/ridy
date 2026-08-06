<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            // The driver's Uber UUID, promoted to its own indexed column so offer
            // routing (lookup by driverUUID) is a fast, direct match. Mirrors
            // external_ids.uber; kept as a first-class column for the hot path.
            $table->string('uber_driver_uuid')->nullable()->after('external_ids')->index();

            // Personal Uber email from the driver's own getUser — used to confirm
            // or manually resolve the link.
            $table->string('uber_email')->nullable()->after('uber_driver_uuid');

            // How the link was established, for auditability.
            $table->string('uber_link_method')->nullable()->after('uber_email'); // auto | manual
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['uber_driver_uuid', 'uber_email', 'uber_link_method']);
        });
    }
};
