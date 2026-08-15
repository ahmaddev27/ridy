<?php

namespace App\Domain\Notifications\Push;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Mints a short-lived OAuth2 access token for the FCM HTTP v1 API from a Google
 * service-account credentials file (self-signed JWT grant, no SDK dependency).
 * The token is cached until shortly before it expires so we exchange at most
 * once per hour rather than on every push.
 */
class GoogleServiceAccountToken
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    private const CACHE_TTL = 3300; // 55 min — Google tokens live 1h.

    public function __construct(private readonly string $credentialsPath) {}

    /** @return array{project_id: string, client_email: string, private_key: string, token_uri: string} */
    public function credentials(): array
    {
        $raw = @file_get_contents($this->credentialsPath);
        $json = $raw ? json_decode($raw, true) : null;
        if (! is_array($json) || empty($json['client_email']) || empty($json['private_key'])) {
            throw new RuntimeException('Invalid FCM service-account credentials file.');
        }

        return [
            'project_id' => (string) ($json['project_id'] ?? ''),
            'client_email' => (string) $json['client_email'],
            'private_key' => (string) $json['private_key'],
            'token_uri' => (string) ($json['token_uri'] ?? 'https://oauth2.googleapis.com/token'),
        ];
    }

    public function accessToken(): string
    {
        $creds = $this->credentials();

        return Cache::remember(
            'fcm.token.'.md5($creds['client_email']),
            self::CACHE_TTL,
            fn () => $this->exchange($creds),
        );
    }

    /** @param array{client_email: string, private_key: string, token_uri: string} $creds */
    private function exchange(array $creds): string
    {
        $now = time();
        $claims = [
            'iss' => $creds['client_email'],
            'scope' => self::SCOPE,
            'aud' => $creds['token_uri'],
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $jwt = $this->sign($claims, $creds['private_key']);

        $response = Http::asForm()->post($creds['token_uri'], [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt,
        ]);

        if (! $response->successful() || ! $response->json('access_token')) {
            throw new RuntimeException('FCM token exchange failed: '.$response->body());
        }

        return (string) $response->json('access_token');
    }

    /** @param array<string, mixed> $claims */
    private function sign(array $claims, string $privateKey): string
    {
        $segments = [
            $this->base64Url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])),
            $this->base64Url(json_encode($claims)),
        ];
        $signingInput = implode('.', $segments);

        $signature = '';
        if (! openssl_sign($signingInput, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Unable to sign the FCM JWT — check the private key.');
        }

        return $signingInput.'.'.$this->base64Url($signature);
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
