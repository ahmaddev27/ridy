<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cash collectors ("شركات التحصيل"): third parties the super-admin registers who
 * collect fleet cash (e.g. monthly subscription payments) on the platform's
 * behalf. A collector is platform-level (not tenant-scoped) — any fleet can pay
 * any collector, and which collector received a given payment is chosen per
 * payment (see collector_payments), not fixed to the fleet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('collectors', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('address')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('collectors');
    }
};
