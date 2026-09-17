<?php

use App\Domain\Billing\CompanyReferenceGenerator;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The company's stable, customer-facing payment reference (e.g. REIDEY-JAB-4821)
 * that it quotes on a bank transfer and to support. Unique; nullable so it can be
 * assigned lazily. Existing companies are backfilled here so the ones already in
 * the database get a reference immediately on deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->string('payment_reference', 32)->nullable()->unique()->after('name');
        });

        $generator = app(CompanyReferenceGenerator::class);
        Tenant::whereNull('payment_reference')->get()->each(fn (Tenant $t) => $generator->assign($t));
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropUnique(['payment_reference']);
            $table->dropColumn('payment_reference');
        });
    }
};
