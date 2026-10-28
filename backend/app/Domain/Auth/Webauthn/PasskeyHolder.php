<?php

namespace App\Domain\Auth\Webauthn;

use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * An identity that can hold passkeys: the dashboard `User` and the app
 * `Driver`. The one layer under `app/Domain/Auth/Webauthn` serves both — the
 * ceremonies, the parked challenge, the row, the generic refusal are the same
 * — so the services take this contract rather than either model. The
 * `HasWebauthnCredentials` trait provides the relation; the names come from
 * the model, since a driver may have no email of their own.
 */
interface PasskeyHolder
{
    /** @return int|string */
    public function getKey();

    /**
     * Untyped on purpose: Eloquent declares it without a return type, and an
     * interface may not narrow what the model's own declaration leaves open.
     *
     * @return string
     */
    public function getMorphClass();

    public function webauthnCredentials(): MorphMany;

    /** The account identifier the authenticator shows in its picker (WebAuthn `user.name`). */
    public function passkeyAccountName(): string;

    /** The human name shown beside it (WebAuthn `user.displayName`). */
    public function passkeyDisplayName(): string;
}
