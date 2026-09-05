<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A proxy subscription is renewed on the SAME credentials — the invoice is paid
 * again for another period. Each renewal is one paid period (amount + start/end),
 * so the admin keeps a full history and a running total of what the proxy cost,
 * while the proxy's own `expires_at` stays the base (first) period.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('proxy_renewals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('proxy_id')->constrained('proxies')->cascadeOnDelete();
            $table->decimal('amount', 10, 2)->default(0);
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->string('note', 500)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('proxy_renewals');
    }
};
