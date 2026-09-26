<?php

use App\Support\Settings;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;

/**
 * Settings used to be cached DECRYPTED (SMTP password, Resend key) under
 * 'platform_settings' in the database cache table — and so in every backup. The
 * cache now holds ciphertext under a new key; drop the old plaintext entry.
 */
return new class extends Migration
{
    public function up(): void
    {
        rescue(fn () => Cache::forget(Settings::LEGACY_CACHE_KEY), report: false);
    }

    public function down(): void
    {
        // Nothing to restore: the entry was a cache.
    }
};
