<?php

namespace App\Domain\Auth\Webauthn\Concerns;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * An identity that can hold passkeys — `User` today, `Driver` in the app phase.
 *
 * The credentials row has no foreign key (it is polymorphic), so the database
 * cannot cascade; this trait does it on the model's `deleting` event. Code that
 * deletes identities through the query builder, which fires no events, must
 * take the rows along itself — `CompanyDeleter` and the roster de-duplication
 * do.
 */
trait HasWebauthnCredentials
{
    public static function bootHasWebauthnCredentials(): void
    {
        static::deleting(function (Model $model): void {
            $model->webauthnCredentials()->delete();
        });
    }

    /** The passkeys registered on this account (docs/22). */
    public function webauthnCredentials(): MorphMany
    {
        return $this->morphMany(WebauthnCredential::class, 'authenticatable');
    }

    /** WebAuthn `user.name`: the email by default; a model without one overrides this. */
    public function passkeyAccountName(): string
    {
        return (string) ($this->email ?: $this->getKey());
    }

    /** WebAuthn `user.displayName`: the person's name, falling back to the account name. */
    public function passkeyDisplayName(): string
    {
        return (string) ($this->name ?: $this->passkeyAccountName());
    }
}
