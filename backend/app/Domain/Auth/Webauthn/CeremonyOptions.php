<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Models\User;
use ParagonIE\ConstantTime\Base64UrlSafe;

/**
 * Builds the options a ceremony starts with, in the JSON shape the browser's
 * `PublicKeyCredential.parseCreationOptionsFromJSON()` / `parseRequestOptionsFromJSON()`
 * take (binary fields base64url). The same JSON is what the engine re-reads
 * on verify, so it is produced as plain arrays here — not through the
 * engine's objects — and stored credential ids pass through untouched.
 */
class CeremonyOptions
{
    /** COSE algorithms, in preference order: ES256 then RS256 — the engine's default verifier set. */
    private const ALGORITHMS = [-7, -257];

    /**
     * Registration: a discoverable (resident) credential with user verification,
     * so sign-in needs neither a username nor a second prompt.
     *
     * @param  iterable<WebauthnCredential>  $exclude  the account's existing passkeys, so an authenticator that already holds one refuses a duplicate
     * @return array<string, mixed>
     */
    public function creation(User $user, string $userHandle, iterable $exclude): array
    {
        $excludeCredentials = [];
        foreach ($exclude as $credential) {
            $excludeCredentials[] = [
                'type' => 'public-key',
                'id' => $credential->id,
                'transports' => $credential->transports ?? [],
            ];
        }

        return [
            'rp' => [
                'id' => $this->rpId(),
                'name' => (string) config('webauthn.rp_name', 'Reidey'),
            ],
            'user' => [
                'id' => Base64UrlSafe::encodeUnpadded($userHandle),
                'name' => $user->email,
                'displayName' => $user->name,
            ],
            'challenge' => self::challenge(),
            'pubKeyCredParams' => array_map(
                fn (int $alg) => ['type' => 'public-key', 'alg' => $alg],
                self::ALGORITHMS,
            ),
            'timeout' => $this->timeoutMs(),
            'excludeCredentials' => $excludeCredentials,
            'authenticatorSelection' => [
                'residentKey' => 'required',
                'userVerification' => 'required',
            ],
            // No AAGUID trust chains: nothing beyond what the ceremony needs
            // (DSGVO "detect, don't surveil"), and the engine's default.
            'attestation' => 'none',
        ];
    }

    /**
     * Sign-in: username-less. No `allowCredentials`, so the options carry no
     * hint about who exists or who owns a passkey — the browser offers the
     * discoverable credentials it holds for this rpId.
     *
     * @return array<string, mixed>
     */
    public function request(): array
    {
        return [
            'challenge' => self::challenge(),
            'rpId' => $this->rpId(),
            'timeout' => $this->timeoutMs(),
            'userVerification' => 'required',
            'allowCredentials' => [],
        ];
    }

    /** 32 random bytes, base64url — the engine demands at least 16. */
    public static function challenge(): string
    {
        return Base64UrlSafe::encodeUnpadded(random_bytes(32));
    }

    private function rpId(): string
    {
        return (string) config('webauthn.rp_id', 'localhost');
    }

    private function timeoutMs(): int
    {
        return (int) config('webauthn.timeout_ms', 60000);
    }
}
