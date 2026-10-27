<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Adds a passkey to an already-authenticated dashboard account.
 *
 * Enrolment is never public (docs/22 §6): the caller is a signed-in user, the
 * ceremony is single-use, and the row is written only after the engine
 * verified the attestation. The 422 codes are distinct on purpose — the UI
 * tells an expired ceremony from an already-registered authenticator.
 */
class PasskeyRegistrar
{
    public function __construct(
        private readonly ChallengeStore $challenges,
        private readonly CeremonyOptions $options,
        private readonly CeremonyVerifier $verifier,
    ) {}

    /**
     * @return array{ceremony_id: string, options: array<string, mixed>}
     */
    public function start(User $user): array
    {
        $existing = $user->webauthnCredentials()->get();
        // The handle stays the same across enrolments so an authenticator keeps
        // one credential per account; a first enrolment mints it.
        $userHandle = $existing->first()?->user_handle ?? (string) Str::uuid();

        $options = $this->options->creation($user, $userHandle, $existing);

        // The parked ceremony names its owner, so it can only be finished by
        // the account that started it — never with another account's handle.
        $parked = json_encode(['owner' => $user->getKey(), 'options' => $options], JSON_THROW_ON_ERROR);

        return [
            'ceremony_id' => $this->challenges->put($parked),
            'options' => $options,
        ];
    }

    /**
     * @param  array<string, mixed>  $credential  the browser's answer, `toJSON()` shape
     *
     * @throws ValidationException `ceremony_expired` | `verification_failed` | `credential_exists`
     */
    public function finish(User $user, string $ceremonyId, array $credential, ?string $alias): WebauthnCredential
    {
        $optionsJson = $this->optionsOwnedBy($user, $ceremonyId);
        if ($optionsJson === null) {
            throw ValidationException::withMessages(['ceremony_id' => ['ceremony_expired']]);
        }

        try {
            $verified = $this->verifier->verifyRegistration($optionsJson, $credential);
        } catch (WebauthnVerificationFailed $e) {
            Log::info('webauthn.registration_failed', ['user_id' => $user->id, 'reason' => $e->getMessage()]);

            throw ValidationException::withMessages(['credential' => ['verification_failed']]);
        }

        if (WebauthnCredential::query()->whereKey($verified->credentialId)->exists()) {
            throw ValidationException::withMessages(['credential' => ['credential_exists']]);
        }

        $alias = $alias === null ? null : trim($alias);

        try {
            return $user->webauthnCredentials()->create([
                'id' => $verified->credentialId,
                'user_handle' => $verified->userHandle,
                'counter' => $verified->counter,
                'rp_id' => $verified->rpId,
                'origin' => $verified->origin,
                'transports' => $verified->transports,
                'aaguid' => $verified->aaguid,
                'public_key' => $verified->publicKey,
                'attestation_format' => $verified->attestationFormat,
                'alias' => $alias === '' ? null : $alias,
            ]);
        } catch (UniqueConstraintViolationException) {
            // Two valid ceremonies for one authenticator finishing at once: the
            // loser gets the same answer as the check above, not a 500.
            throw ValidationException::withMessages(['credential' => ['credential_exists']]);
        }
    }

    /**
     * The parked options, only when the ceremony exists AND belongs to this
     * user. A ceremony pulled by anyone else is spent all the same — it is
     * single-use whoever answers it.
     */
    private function optionsOwnedBy(User $user, string $ceremonyId): ?string
    {
        $parked = $this->challenges->pull($ceremonyId);
        if ($parked === null) {
            return null;
        }

        $payload = json_decode($parked, true);
        if (! is_array($payload) || ($payload['owner'] ?? null) !== $user->getKey() || ! is_array($payload['options'] ?? null)) {
            return null;
        }

        return json_encode($payload['options'], JSON_THROW_ON_ERROR);
    }
}
