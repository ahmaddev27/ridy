<?php

namespace Tests\Unit;

use App\Domain\Auth\Webauthn\CeremonyOptions;
use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Domain\Auth\Webauthn\WebauthnLibCeremonyVerifier;
use App\Domain\Auth\Webauthn\WebauthnVerificationFailed;
use App\Models\User;
use CBOR\ByteStringObject;
use CBOR\MapObject;
use CBOR\NegativeIntegerObject;
use CBOR\TextStringObject;
use CBOR\UnsignedIntegerObject;
use OpenSSLAsymmetricKey;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Tests\TestCase;

/**
 * The real engine behind the seam, driven by a minimal in-test authenticator
 * (ES256 via OpenSSL, `none` attestation). Not a re-test of the engine — its
 * own suite does that — but of OUR wiring: the options JSON this side builds
 * must be what the engine re-reads, the stored row must rebuild into the
 * engine's record, and the config-driven origin/rpId must bite.
 */
class WebauthnLibCeremonyVerifierTest extends TestCase
{
    private const RP_ID = 'localhost';

    private const ORIGIN = 'http://localhost';

    /**
     * A throwaway P-256 key, fixed rather than generated: openssl_pkey_new()
     * needs an openssl.cnf the Windows PHP builds do not ship with, and a
     * test key that only ever signs test vectors has nothing to protect.
     */
    private const TEST_KEY_PEM = <<<'PEM'
        -----BEGIN EC PRIVATE KEY-----
        MHcCAQEEIH9MjEUNTFqisNdj90m1h5p8HnsOAbLJwV9i1210WbtmoAoGCCqGSM49
        AwEHoUQDQgAEQJiZrb2CtV8Rhiv813rg113f54XeOpR7XByDXcc5QrXGiqfjjOd9
        EQI6hhqzh7V+vFwfP3mttXfy2MovNBaMBQ==
        -----END EC PRIVATE KEY-----
        PEM;

    private OpenSSLAsymmetricKey $privateKey;

    private string $credentialId;

    protected function setUp(): void
    {
        parent::setUp();

        config(['webauthn.rp_id' => self::RP_ID, 'webauthn.rp_name' => 'Reidey']);

        $key = openssl_pkey_get_private(self::TEST_KEY_PEM);
        $this->assertNotFalse($key);
        $this->privateKey = $key;
        $this->credentialId = random_bytes(32);
    }

    public function test_a_none_attestation_registers_with_the_options_this_side_builds(): void
    {
        $options = $this->creationOptions('handle-abc');

        $verified = $this->verifier()->verifyRegistration(json_encode($options), $this->attestation($options));

        $this->assertSame(Base64UrlSafe::encodeUnpadded($this->credentialId), $verified->credentialId);
        $this->assertSame('handle-abc', $verified->userHandle);
        $this->assertSame(0, $verified->counter);
        $this->assertSame('none', $verified->attestationFormat);
        $this->assertSame(self::ORIGIN, $verified->origin);
        $this->assertSame(self::RP_ID, $verified->rpId);
        $this->assertSame(['internal'], $verified->transports);
        $this->assertNull($verified->aaguid, 'the nil AAGUID of a none attestation is stored as null');
    }

    public function test_an_assertion_verifies_against_the_stored_row_and_returns_the_new_counter(): void
    {
        $stored = $this->storedCredential('handle-abc', counter: 0);
        $options = $this->requestOptions();

        $counter = $this->verifier()->verifyAssertion(json_encode($options), $this->assertion($options, 'handle-abc', 7), $stored);

        $this->assertSame(7, $counter);
    }

    public function test_an_attestation_from_an_unlisted_origin_is_refused(): void
    {
        $options = $this->creationOptions('handle-abc');

        $this->expectException(WebauthnVerificationFailed::class);

        $this->verifier()->verifyRegistration(json_encode($options), $this->attestation($options, origin: 'https://evil.example'));
    }

    public function test_a_tampered_signature_is_refused(): void
    {
        $stored = $this->storedCredential('handle-abc', counter: 0);
        $options = $this->requestOptions();
        $assertion = $this->assertion($options, 'handle-abc', 1);
        $assertion['response']['signature'] = Base64UrlSafe::encodeUnpadded(random_bytes(70));

        $this->expectException(WebauthnVerificationFailed::class);

        $this->verifier()->verifyAssertion(json_encode($options), $assertion, $stored);
    }

    public function test_a_counter_that_did_not_advance_is_refused(): void
    {
        $stored = $this->storedCredential('handle-abc', counter: 9);
        $options = $this->requestOptions();

        $this->expectException(WebauthnVerificationFailed::class);

        $this->verifier()->verifyAssertion(json_encode($options), $this->assertion($options, 'handle-abc', 9), $stored);
    }

    public function test_an_answer_to_a_different_challenge_is_refused(): void
    {
        $stored = $this->storedCredential('handle-abc', counter: 0);
        $sent = $this->requestOptions();
        $other = $this->requestOptions();

        $this->expectException(WebauthnVerificationFailed::class);

        $this->verifier()->verifyAssertion(json_encode($sent), $this->assertion($other, 'handle-abc', 1), $stored);
    }

    public function test_a_malformed_payload_is_a_verification_failure_not_a_crash(): void
    {
        $options = $this->requestOptions();

        $this->expectException(WebauthnVerificationFailed::class);

        $this->verifier()->verifyAssertion(json_encode($options), ['id' => 'x', 'type' => 'public-key'], $this->storedCredential('h', 0));
    }

    public function test_an_android_apk_key_hash_origin_is_matched_verbatim(): void
    {
        // The driver app on Android asserts no web origin but the hash of its
        // signing certificate (docs/22 §4.3); the engine matches such an
        // allow-list entry verbatim (≥ 5.3.3), so one entry per signing key in
        // WEBAUTHN_ORIGINS is all the server needs. A throwaway hash here — the
        // real ones arrive with Phase 0.
        $androidOrigin = 'android:apk-key-hash:'.Base64UrlSafe::encodeUnpadded(random_bytes(32));
        $options = $this->creationOptions('handle-abc');

        $verified = (new WebauthnLibCeremonyVerifier(self::RP_ID, [self::ORIGIN, $androidOrigin]))
            ->verifyRegistration(json_encode($options), $this->attestation($options, origin: $androidOrigin));

        $this->assertSame($androidOrigin, $verified->origin);
        $this->assertSame(self::RP_ID, $verified->rpId);

        // The same answer against a list without it (the dashboard-only verifier): refused.
        $this->expectException(WebauthnVerificationFailed::class);
        $this->verifier()->verifyRegistration(json_encode($options), $this->attestation($options, origin: $androidOrigin));
    }

    // --- the virtual authenticator -------------------------------------------------

    private function verifier(): WebauthnLibCeremonyVerifier
    {
        return new WebauthnLibCeremonyVerifier(self::RP_ID, [self::ORIGIN]);
    }

    /** @return array<string, mixed> */
    private function creationOptions(string $userHandle): array
    {
        $user = User::make(['name' => 'Anna', 'email' => 'anna@acme.de']);

        return app(CeremonyOptions::class)->creation($user, $userHandle, []);
    }

    /** @return array<string, mixed> */
    private function requestOptions(): array
    {
        return app(CeremonyOptions::class)->request();
    }

    private function storedCredential(string $userHandle, int $counter): WebauthnCredential
    {
        return new WebauthnCredential([
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'user_handle' => $userHandle,
            'counter' => $counter,
            'transports' => ['internal'],
            'aaguid' => null,
            'public_key' => base64_encode($this->coseKey()),
            'attestation_format' => 'none',
        ]);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function attestation(array $options, string $origin = self::ORIGIN): array
    {
        $clientDataJson = $this->clientDataJson('webauthn.create', $options['challenge'], $origin);

        // rpIdHash ‖ flags(UP|UV|AT) ‖ signCount ‖ aaguid ‖ credIdLen ‖ credId ‖ COSE key
        $authData = hash('sha256', self::RP_ID, true)
            .chr(0x01 | 0x04 | 0x40)
            .pack('N', 0)
            .str_repeat("\0", 16)
            .pack('n', strlen($this->credentialId))
            .$this->credentialId
            .$this->coseKey();

        $attestationObject = (string) MapObject::create()
            ->add(TextStringObject::create('fmt'), TextStringObject::create('none'))
            ->add(TextStringObject::create('attStmt'), MapObject::create())
            ->add(TextStringObject::create('authData'), ByteStringObject::create($authData));

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'authenticatorAttachment' => 'platform',
            'response' => [
                'clientDataJSON' => Base64UrlSafe::encodeUnpadded($clientDataJson),
                'attestationObject' => Base64UrlSafe::encodeUnpadded($attestationObject),
                'transports' => ['internal'],
                // The extras a modern browser's toJSON() adds; the engine must ignore them.
                'authenticatorData' => Base64UrlSafe::encodeUnpadded($authData),
                'publicKeyAlgorithm' => -7,
                'publicKey' => Base64UrlSafe::encodeUnpadded(random_bytes(91)),
            ],
            'clientExtensionResults' => ['credProps' => ['rk' => true]],
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function assertion(array $options, string $userHandle, int $signCount): array
    {
        $clientDataJson = $this->clientDataJson('webauthn.get', $options['challenge'], self::ORIGIN);
        $authData = hash('sha256', self::RP_ID, true).chr(0x01 | 0x04).pack('N', $signCount);

        $signed = openssl_sign($authData.hash('sha256', $clientDataJson, true), $signature, $this->privateKey, OPENSSL_ALGO_SHA256);
        $this->assertTrue($signed);

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => Base64UrlSafe::encodeUnpadded($clientDataJson),
                'authenticatorData' => Base64UrlSafe::encodeUnpadded($authData),
                'signature' => Base64UrlSafe::encodeUnpadded($signature),
                'userHandle' => Base64UrlSafe::encodeUnpadded($userHandle),
            ],
            'clientExtensionResults' => (object) [],
        ];
    }

    private function clientDataJson(string $type, string $challenge, string $origin): string
    {
        return json_encode(['type' => $type, 'challenge' => $challenge, 'origin' => $origin, 'crossOrigin' => false]);
    }

    /** The ES256 public key as a COSE_Key map (kty EC2, alg ES256, crv P-256, x, y). */
    private function coseKey(): string
    {
        $details = openssl_pkey_get_details($this->privateKey);
        $this->assertIsArray($details);

        return (string) MapObject::create()
            ->add(UnsignedIntegerObject::create(1), UnsignedIntegerObject::create(2))
            ->add(UnsignedIntegerObject::create(3), NegativeIntegerObject::create(-7))
            ->add(NegativeIntegerObject::create(-1), UnsignedIntegerObject::create(1))
            ->add(NegativeIntegerObject::create(-2), ByteStringObject::create(str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT)))
            ->add(NegativeIntegerObject::create(-3), ByteStringObject::create(str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT)));
    }
}
