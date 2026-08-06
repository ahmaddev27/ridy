<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            // Uber fleet/partner UUID (= partnerUUID in dispatch offers). Captured
            // from getUser when the manager links Uber. Ties a tenant to its fleet.
            $table->string('uber_org_uuid')->nullable()->after('country')->index();
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn('uber_org_uuid');
        });
    }
};
