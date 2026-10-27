<?php

namespace Database\Factories;

use App\Domain\Auth\Webauthn\Models\WebauthnCredential;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;
use ParagonIE\ConstantTime\Base64UrlSafe;

/**
 * @extends Factory<WebauthnCredential>
 */
class WebauthnCredentialFactory extends Factory
{
    protected $model = WebauthnCredential::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'id' => Base64UrlSafe::encodeUnpadded(random_bytes(32)),
            // Overridden by ->for($model, 'authenticatable'); a bare create() gets a user.
            'authenticatable_type' => User::class,
            'authenticatable_id' => User::factory(),
            'user_handle' => (string) Str::uuid(),
            'counter' => 0,
            'rp_id' => 'localhost',
            'origin' => 'http://localhost',
            'transports' => ['internal'],
            'aaguid' => null,
            // Opaque bytes: nothing here verifies a signature (that is the engine's suite).
            'public_key' => base64_encode(random_bytes(77)),
            'attestation_format' => 'none',
            'alias' => null,
            'last_used_at' => null,
            'disabled_at' => null,
        ];
    }
}
