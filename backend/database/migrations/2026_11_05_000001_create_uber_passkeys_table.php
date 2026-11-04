<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('uber_passkeys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('uber_org_uuid')->nullable();
            $table->char('credential_id_hash', 64);
            // Encrypted at rest (model cast): holds the private key.
            $table->text('credential');
            $table->string('status')->default('active');
            $table->timestamp('registered_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->unsignedInteger('use_count')->default(0);
            $table->string('failure_reason')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        // Never roll back automatically: the passkey is registered on Uber's side and
        // dropping the table would orphan it. Drop manually if truly intended.
    }
};
