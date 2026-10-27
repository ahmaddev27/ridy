<?php

namespace App\Domain\Auth\Webauthn\Models;

use Database\Factories\WebauthnCredentialFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * One registered passkey. The table is polymorphic on purpose: a dashboard
 * `User` today, a `Driver` in the app phase (docs/22 §7), same columns.
 *
 * `id` is the credential id the authenticator minted, base64url — the string
 * the browser sends back on every sign-in, so it is the natural key. The
 * public key is stored as the public material it is (owner decision: encrypting
 * it would weld every passkey to APP_KEY). Neither it nor the user handle ever
 * leaves the server: both are hidden from serialisation.
 */
class WebauthnCredential extends Model
{
    /** @use HasFactory<WebauthnCredentialFactory> */
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id', 'authenticatable_type', 'authenticatable_id', 'user_handle', 'counter', 'rp_id', 'origin',
        'transports', 'aaguid', 'public_key', 'attestation_format', 'alias', 'last_used_at', 'disabled_at',
    ];

    protected $hidden = ['public_key', 'user_handle'];

    protected $casts = [
        'counter' => 'integer',
        'transports' => 'array',
        'last_used_at' => 'datetime',
        'disabled_at' => 'datetime',
    ];

    public function authenticatable(): MorphTo
    {
        return $this->morphTo();
    }

    /** Credentials that may still sign in. */
    public function scopeEnabled(Builder $query): Builder
    {
        return $query->whereNull('disabled_at');
    }

    protected static function newFactory(): WebauthnCredentialFactory
    {
        return WebauthnCredentialFactory::new();
    }
}
