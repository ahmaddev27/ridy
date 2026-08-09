<?php

namespace App\Support;

use App\Models\Setting;
use Illuminate\Support\Facades\Cache;

/**
 * Typed access to the live platform settings, cached so hot paths (e.g. applying
 * the mail config on boot) don't hit the DB on every request. Writes bust the
 * cache. Secrets are decrypted by the Setting model cast before caching.
 */
class Settings
{
    private const CACHE_KEY = 'platform_settings';

    /** @return array<string, string|null> */
    public static function all(): array
    {
        return Cache::rememberForever(self::CACHE_KEY, fn () => Setting::all()->pluck('value', 'key')->toArray());
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = self::all()[$key] ?? null;

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
}
