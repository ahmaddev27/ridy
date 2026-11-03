<?php

namespace App\Domain\Auth\Webauthn;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Username-less sign-in with a passkey — for the dashboard (`User`) and the
 * driver app (`Driver`) alike; the caller names which identity it signs in.
 *
 * Every refusal reads the same — unknown credential, the other identity's
 * credential, a disabled one, a failed signature — so a public endpoint
 * cannot be used to learn who exists or who owns a passkey. Only an expired
 * ceremony is named: that is the caller's own state and says nothing about
 * accounts.
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
     * @template T of PasskeyHolder
     *
     * @param  array<string, mixed>  $credential  the client's answer, `toJSON()` shape
     * @param  class-string<T>|array<int, class-string<T>>  $accountClasses  the identities this sign-in may resolve; a credential of any other reads as unknown
     * @param  PasskeyScope  $scope  the front door: only a credential enrolled for it matches (no default, on purpose)
     * @return T
     *
     * @throws ValidationException `ceremony_expired` | the generic refusal
     */
    public function authenticate(string $ceremonyId, array $credential, string|array $accountClasses, PasskeyScope $scope): PasskeyHolder
    {
        $accountClasses = (array) $accountClasses;
        foreach ($accountClasses as $accountClass) {
            if (! is_subclass_of($accountClass, PasskeyHolder::class)) {
                throw new InvalidArgumentException("{$accountClass} cannot hold passkeys.");
            }
        }

        $optionsJson = $this->challenges->pull($ceremonyId);
        if ($optionsJson === null) {
            throw ValidationException::withMessages(['ceremony_id' => ['ceremony_expired']]);
        }

        // Only the named identity: a driver's credential at the dashboard login,
        // or a manager's at the app login, is refused exactly like an unknown
        // one. The bodies are identical; the timing is not (no signature check
        // on this path). Accepted: a credential id is 16–64 random bytes, so
        // only someone already holding one can probe it, and holding it tells
        // them nothing they did not have.
        $stored = WebauthnCredential::query()
            ->enabled()
            ->whereKey((string) ($credential['id'] ?? ''))
            ->where('scope', $scope->value)
            ->whereIn('authenticatable_type', array_map(fn (string $class): string => (new $class)->getMorphClass(), $accountClasses))
            ->first();

        if ($stored === null) {
            throw self::refusal();
        }

        try {
            $counter = $this->verifier->verifyAssertion($optionsJson, $credential, $stored);
        } catch (WebauthnVerificationFailed $e) {
            Log::info('webauthn.assertion_failed', ['credential_id' => $stored->id, 'reason' => $e->getMessage()]);

            throw self::refusal();
        }

        $stored->forceFill(['counter' => $counter, 'last_used_at' => now()])->save();

        $account = $stored->authenticatable;
        if (! $this->isAllowed($account, $accountClasses)) {
            throw self::refusal();
        }

        return $account;
    }

    /** @param  array<int, class-string>  $accountClasses */
    private function isAllowed(?object $account, array $accountClasses): bool
    {
        foreach ($accountClasses as $class) {
            if ($account instanceof $class) {
                return true;
            }
        }

        return false;
    }

    /**
     * The one generic refusal — the same words the password login uses. Public
     * so a caller's own post-assertion identity rule answers in the same voice.
     */
    public static function refusal(): ValidationException
    {
        return ValidationException::withMessages(['credential' => [__('auth.failed')]]);
    }
}
