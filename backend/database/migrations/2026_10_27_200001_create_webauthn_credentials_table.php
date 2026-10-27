<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Passkeys (WebAuthn credentials) — docs/22-passkey-groundwork.md §7.
 *
 * One polymorphic table for both identity models: a dashboard `User` now, a
 * `Driver` in the app phase, with no schema change between them. Shape modelled
 * on laragear/webauthn's shipped migration (the package itself was rejected as
 * abandoned; its schema is still the best reference).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webauthn_credentials', function (Blueprint $table) {
            // The credential id the authenticator minted, base64url. Up to 1023
            // raw bytes by spec, in practice 16–64; 510 chars is what laragear
            // sized it at and fits an InnoDB primary key under utf8mb4.
            $table->string('id', 510)->primary();
            $table->morphs('authenticatable');

            // The opaque, stable per-account id the authenticator stores with the
            // credential (user.id in the ceremony). One per account, reused on
            // every enrolment, so a second passkey on the same authenticator
            // replaces the first instead of piling up.
            $table->uuid('user_handle')->index();

            // Signature counter from the authenticator; a value that does not
            // increase is the engine's clone signal.
            $table->unsignedBigInteger('counter')->default(0);
            $table->string('rp_id');
            // The enrolling origin: a web origin, or later an android:apk-key-hash string.
            $table->string('origin');
            $table->json('transports')->nullable();
            // The authenticator model's id as claimed; under attestation 'none'
            // it is untrusted and only informational.
            $table->uuid('aaguid')->nullable();
            // The COSE public key, base64. Public material, stored as such.
            $table->text('public_key');
            $table->string('attestation_format', 32)->default('none');
            // "Pixel 8 von Ali" — the label the management UI shows.
            $table->string('alias', 64)->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('disabled_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webauthn_credentials');
    }
};
