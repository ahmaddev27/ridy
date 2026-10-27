<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Uid\Uuid;
use Throwable;
use Webauthn\AttestationStatement\AttestationStatement;
use Webauthn\AttestationStatement\AttestationStatementSupportManager;
use Webauthn\AttestationStatement\NoneAttestationStatementSupport;
use Webauthn\AuthenticatorAssertionResponse;
use Webauthn\AuthenticatorAssertionResponseValidator;
use Webauthn\AuthenticatorAttestationResponse;
use Webauthn\AuthenticatorAttestationResponseValidator;
use Webauthn\CeremonyStep\CeremonyStepManagerFactory;
use Webauthn\CredentialRecord;
use Webauthn\Denormalizer\WebauthnSerializerFactory;
use Webauthn\PublicKeyCredential;
use Webauthn\PublicKeyCredentialCreationOptions;
use Webauthn\PublicKeyCredentialRequestOptions;
use Webauthn\TrustPath\EmptyTrustPath;

/**
 * The production {@see CeremonyVerifier}: web-auth/webauthn-lib ≥ 5.3.3
 * (docs/22 §2 — the first release whose origin allow-list matches an
 * `android:apk-key-hash:…` entry verbatim, which the driver phase needs).
 *
 * Attestation policy is `none` only: no AAGUID trust chains, no metadata
 * service — the engine's default and the DSGVO posture. Origins come from
 * config, never from the request. Every engine failure, and every malformed
 * payload, surfaces as one {@see WebauthnVerificationFailed}.
 */
final class WebauthnLibCeremonyVerifier implements CeremonyVerifier
{
    private const NIL_AAGUID = '00000000-0000-0000-0000-000000000000';

    private readonly SerializerInterface $serializer;

    private readonly CeremonyStepManagerFactory $ceremonies;

    /**
     * @param  list<string>  $allowedOrigins
     */
    public function __construct(private readonly string $rpId, array $allowedOrigins)
    {
        $attestations = new AttestationStatementSupportManager([new NoneAttestationStatementSupport]);

        $this->ceremonies = new CeremonyStepManagerFactory;
        $this->ceremonies->setAttestationStatementSupportManager($attestations);
        $this->ceremonies->setAllowedOrigins($allowedOrigins);

        $this->serializer = (new WebauthnSerializerFactory($attestations))->create();
    }

    public function verifyRegistration(string $optionsJson, array $credential): VerifiedRegistration
    {
        try {
            $options = $this->serializer->deserialize($optionsJson, PublicKeyCredentialCreationOptions::class, 'json');
            $response = $this->deserializeCredential($credential)->response;
            if (! $response instanceof AuthenticatorAttestationResponse) {
                throw new WebauthnVerificationFailed('Expected an attestation response.');
            }

            $record = AuthenticatorAttestationResponseValidator::create($this->ceremonies->creationCeremony())
                ->check($response, $options, $this->rpId);
        } catch (Throwable $e) {
            throw new WebauthnVerificationFailed($e->getMessage(), previous: $e);
        }

        $aaguid = $record->aaguid->toRfc4122();

        return new VerifiedRegistration(
            credentialId: Base64UrlSafe::encodeUnpadded($record->publicKeyCredentialId),
            publicKey: base64_encode($record->credentialPublicKey),
            counter: $record->counter,
            transports: array_values($record->transports),
            aaguid: $aaguid === self::NIL_AAGUID ? null : $aaguid,
            userHandle: $record->userHandle,
            attestationFormat: $response->attestationObject->attStmt->fmt,
            origin: $response->clientDataJSON->origin,
            rpId: $options->rp->id ?? $this->rpId,
        );
    }

    public function verifyAssertion(string $optionsJson, array $credential, WebauthnCredential $stored): int
    {
        try {
            $options = $this->serializer->deserialize($optionsJson, PublicKeyCredentialRequestOptions::class, 'json');
            $response = $this->deserializeCredential($credential)->response;
            if (! $response instanceof AuthenticatorAssertionResponse) {
                throw new WebauthnVerificationFailed('Expected an assertion response.');
            }

            // Username-less: no user handle is asserted up front, so the engine
            // compares the authenticator's handle with the stored row's.
            $record = AuthenticatorAssertionResponseValidator::create($this->ceremonies->requestCeremony())
                ->check($this->recordFor($stored), $response, $options, $this->rpId, null);
        } catch (Throwable $e) {
            throw new WebauthnVerificationFailed($e->getMessage(), previous: $e);
        }

        return $record->counter;
    }

    /**
     * @param  array<string, mixed>  $credential
     */
    private function deserializeCredential(array $credential): PublicKeyCredential
    {
        return $this->serializer->deserialize(
            json_encode($credential, JSON_THROW_ON_ERROR),
            PublicKeyCredential::class,
            'json',
        );
    }

    /** The stored row in the engine's shape. Only `none` attestations are ever stored, so the trust path is empty. */
    private function recordFor(WebauthnCredential $stored): CredentialRecord
    {
        return CredentialRecord::create(
            publicKeyCredentialId: Base64UrlSafe::decodeNoPadding($stored->id),
            type: 'public-key',
            transports: $stored->transports ?? [],
            attestationType: AttestationStatement::TYPE_NONE,
            trustPath: EmptyTrustPath::create(),
            aaguid: Uuid::fromString($stored->aaguid ?? self::NIL_AAGUID),
            credentialPublicKey: (string) base64_decode($stored->public_key, true),
            userHandle: $stored->user_handle,
            counter: $stored->counter,
        );
    }
}
