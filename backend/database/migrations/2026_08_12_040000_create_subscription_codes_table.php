<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every activation code issued — by a reseller or the admin — with its full
 * lifecycle: pending → activated (company used it) or expired (TTL passed). Keeps
 * the plan, price, paid flag, seller (collector) and company, so a reseller sees
 * their own codes and the admin sees them all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_codes', function (Blueprint $table) {
            $table->id();
            $table->string('code', 12)->index();
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->foreignId('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignId('collector_id')->nullable()->constrained('collectors')->nullOnDelete(); // reseller; null = admin
            $table->decimal('amount', 12, 2)->nullable();
            $table->boolean('paid')->default(false);
            $table->timestamp('expires_at');
            $table->timestamp('activated_at')->nullable();
            $table->foreignId('subscription_period_id')->nullable()->constrained('subscription_periods')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['collector_id', 'created_at']);
            $table->index(['tenant_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_codes');
    }
};
