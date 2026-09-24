<?php

namespace App\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

/**
 * Like Laravel's `encrypted` cast, but a value that is not (yet) ciphertext is
 * returned as-is instead of throwing.
 *
 * Used to turn on encryption for a column that already holds plaintext on a live
 * system: existing rows are only encrypted by `tenants:encrypt-proxy-urls`, run
 * after a deploy is confirmed (so a rolled-back release never reads ciphertext),
 * and a hard DecryptException before then would take down the daemon's /sessions
 * feed. Every write is encrypted.
 *
 * @implements CastsAttributes<string|null, string|null>
 */
class EncryptedWithPlaintextFallback implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null || $value === '') {
            return $value;
        }

        try {
            return Crypt::decryptString((string) $value);
        } catch (DecryptException) {
            return (string) $value; // legacy plaintext row
        }
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null || $value === '') {
            return $value === '' ? null : $value;
        }

        return Crypt::encryptString((string) $value);
    }
}
