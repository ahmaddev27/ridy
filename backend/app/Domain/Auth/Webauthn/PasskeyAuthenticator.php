<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Username-less dashboard sign-in with a passkey.
 *
 * Every refusal reads the same — unknown credential, a driver's credential,
 * a disabled one, a failed signature — so the public endpoint cannot be used
 * to learn who exists or who owns a passkey. Only an expired ceremony is
 * named: that is the caller's own state and says nothing about accounts.
 */
class PasskeyAuthenticator
{
    public function __construct(
        private readonly ChallengeStore $challenges,
        private readonly CeremonyOptions $options,
        private readonly CeremonyVerifier $verifier,
    ) {}

    /**
     * @return array{ceremony_id: string, options: array<string, mixed>}
     */
    public function start(): array
    {
        $options = $this->options->request();

        return [
            'ceremony_id' => $this->challenges->put(json_encode($options, JSON_THROW_ON_ERROR)),
            'options' => $options,
        ];
    }

    /**
     * Verifies the assertion and returns the account it proves. The counter is
     * persisted before the caller looks at the account's state: the assertion
     * was valid regardless, and a counter left behind would read as a cloned
     * authenticator on the next sign-in.
     *
     * @param  array<string, mixed>  $credential  the browser's answer, `toJSON()` shape
     *
     * @throws ValidationException `ceremony_expired` | the generic refusal
     */
    public function authenticate(string $ceremonyId, array $credential): User
    {
        $optionsJson = $this->challenges->pull($ceremonyId);
        if ($optionsJson === null) {
            throw ValidationException::withMessages(['ceremony_id' => ['ceremony_expired']]);
        }

        // Dashboard sign-in only ever resolves a User; a driver's credential is
        // refused exactly like an unknown one. The bodies are identical; the
        // timing is not (no signature check on this path). Accepted: a credential
        // id is 16–64 random bytes, so only someone already holding one can probe
        // it, and holding it tells them nothing they did not have.
        $stored = WebauthnCredential::query()
            ->enabled()
            ->whereKey((string) ($credential['id'] ?? ''))
            ->where('authenticatable_type', (new User)->getMorphClass())
            ->first();

        if ($stored === null) {
            throw $this->refused();
        }

        try {
            $counter = $this->verifier->verifyAssertion($optionsJson, $credential, $stored);
        } catch (WebauthnVerificationFailed $e) {
            Log::info('webauthn.assertion_failed', ['credential_id' => $stored->id, 'reason' => $e->getMessage()]);

            throw $this->refused();
        }

        $stored->forceFill(['counter' => $counter, 'last_used_at' => now()])->save();

        $user = $stored->authenticatable;
        if (! $user instanceof User) {
            throw $this->refused();
        }

        return $user;
    }

    /** The one generic refusal — the same words the password login uses. */
    private function refused(): ValidationException
    {
        return ValidationException::withMessages(['credential' => [__('auth.failed')]]);
    }
}
