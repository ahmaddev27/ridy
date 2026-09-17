<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A company's "I've paid" claim: it transferred the fee and is asking the admin
 * to verify the incoming bank transfer (matched by the company's payment
 * reference) and issue an activation code. At most one PENDING claim per company
 * exists at a time (enforced in the service) so a company can't spam the admin
 * list; resolving it (confirmed/rejected) frees the company to claim again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('reference', 32); // snapshot of the company reference at claim time
            $table->string('status', 16)->default('pending'); // pending | confirmed | rejected
            $table->string('reason', 500)->nullable();        // admin's note, shown to the company on resolve
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_claims');
    }
};
