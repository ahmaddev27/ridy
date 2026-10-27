<?php

namespace App\Domain\Auth\Webauthn;

/**
 * What a verified attestation yields — exactly the columns a credential row
 * needs, already in storable form (base64url credential id, base64 COSE key).
 */
final readonly class VerifiedRegistration
{
    /** @param  list<string>  $transports */
    public function __construct(
        public string $credentialId,
        public string $publicKey,
        public int $counter,
        public array $transports,
        public ?string $aaguid,
        public string $userHandle,
        public string $attestationFormat,
        public string $origin,
        public string $rpId,
    ) {}
}
