<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;

/**
 * The one seam between Reidey and the cryptographic engine.
 *
 * Everything that is OURS — routes, guards, throttles, single-use ceremonies,
 * persistence, scoping — sits on this side of the line and is tested for real;
 * the signature and attestation checks sit behind it, where the engine's own
 * suite covers them. Tests bind a fake here; production binds
 * {@see WebauthnLibCeremonyVerifier}.
 *
 * Both methods throw {@see WebauthnVerificationFailed} for any answer that
 * does not verify, with the engine's reason attached for the log — never
 * for the client, who gets one generic refusal.
 */
interface CeremonyVerifier
{
    /**
     * @param  string  $optionsJson  the creation options exactly as they were sent to the browser
     * @param  array<string, mixed>  $credential  the browser's PublicKeyCredential, `toJSON()` shape
     *
     * @throws WebauthnVerificationFailed
     */
    public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration;

    /**
     * @param  string  $optionsJson  the request options exactly as they were sent to the browser
     * @param  array<string, mixed>  $credential  the browser's PublicKeyCredential, `toJSON()` shape
     * @return int the authenticator's new signature counter, to persist on the credential
     *
     * @throws WebauthnVerificationFailed
     */
    public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int;
}
