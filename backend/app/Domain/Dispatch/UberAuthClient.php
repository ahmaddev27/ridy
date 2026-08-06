<?php

namespace App\Domain\Dispatch;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Talks to the Node uber-auth service that owns the live sign-in browsers.
 * Laravel never runs a browser itself; it only orchestrates and stores results.
 */
class UberAuthClient
{
    private function request(): PendingRequest
    {
        return Http::withHeaders(['X-Auth-Secret' => (string) config('services.uber_auth.secret')])
            ->timeout((int) config('services.uber_auth.timeout', 60))
            ->acceptJson()
            ->baseUrl(rtrim((string) config('services.uber_auth.url'), '/'));
    }

    /**
     * @return array<string, mixed> { status, login_id?, cookies?, org_uuid?, expires_at?, message? }
     */
    public function start(string $email, string $password): array
    {
        return $this->request()->post('/login/start', ['email' => $email, 'password' => $password])->json() ?? [];
    }

    /**
     * @return array<string, mixed>
     */
    public function submitMfa(string $loginId, string $code): array
    {
        return $this->request()->post('/login/mfa', ['login_id' => $loginId, 'code' => $code])->json() ?? [];
    }

    public function cancel(string $loginId): void
    {
        $this->request()->post('/login/cancel', ['login_id' => $loginId]);
    }
}
