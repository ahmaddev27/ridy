<?php

namespace App\Support;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Throwable;

/**
 * Typed access to the live platform settings, cached so hot paths (e.g. applying
 * the mail config on boot) don't hit the DB on every request. Writes bust the
 * cache.
 *
 * The cache holds the CIPHERTEXT exactly as stored (values are encrypted at rest
 * by the Setting model) and decrypts on read. The cache lives in the same MySQL
 * database and its backups, so caching the decrypted map would put the SMTP
 * password / Resend key there in plaintext and defeat the encryption.
 */
class Settings
{
    /** v2: ciphertext map. The v1 key held decrypted values and is purged by migration. */
    private const CACHE_KEY = 'platform_settings.v2';

    public const LEGACY_CACHE_KEY = 'platform_settings';

    /** @return array<string, string|null> decrypted key => value */
    public static function all(): array
    {
        return array_map(self::decrypt(...), self::encryptedMap());
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = self::decrypt(self::encryptedMap()[$key] ?? null);

        return ($value === null || $value === '') ? $default : $value;
    }

    /** @param array<string, string|null> $values */
    public static function setMany(array $values): void
    {
        foreach ($values as $key => $value) {
            Setting::updateOrCreate(['key' => $key], ['value' => $value]);
        }
        Cache::forget(self::CACHE_KEY);
    }

    /** @return array<string, string|null> key => raw (encrypted) column value */
    private static function encryptedMap(): array
    {
        return Cache::rememberForever(
            self::CACHE_KEY,
            fn () => Setting::query()->toBase()->pluck('value', 'key')->all(),
        );
    }

    private static function decrypt(?string $cipher): ?string
    {
        if ($cipher === null || $cipher === '') {
            return $cipher;
        }

        try {
            // Same unserialize=false decrypt the model's 'encrypted' cast uses.
            return Crypt::decryptString($cipher);
        } catch (Throwable) {
            return null; // undecryptable (rotated APP_KEY) — behave as unset
        }
    }
}
