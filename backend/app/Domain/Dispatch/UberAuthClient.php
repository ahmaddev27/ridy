<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\Http;

/**
 * Thin client for the uber-auth service (the persistent session-browser process).
 * The dashboard drives an interactive Uber sign-in through here: the password is
 * relayed for a SINGLE sign-in and is NEVER stored — on success uber-auth keeps the
 * browser alive per company and pushes captures + status back to our internal
 * endpoints. secret-guarded by the service's own X-Auth-Secret.
 */
class UberAuthClient
{
    public function configured(): bool
    {
        return $this->baseUrl() !== '' && (string) config('services.uber_auth.secret') !== '';
    }

    /**
     * Begin a login for a company. company_key = tenant id, so the browser the
     * service adopts is bound to this tenant for its capture + status pushes.
     *
     * @return array<string, mixed>
     */
    public function startLogin(Tenant $tenant, string $email, string $password): array
    {
        return $this->post('/login/start', [
            'email' => $email,
            'password' => $password,
            'company_key' => (string) $tenant->id,
        ]);
    }

    /** @return array<string, mixed> */
    public function submitMfa(string $loginId, string $code): array
    {
        return $this->post('/login/mfa', ['login_id' => $loginId, 'code' => $code]);
    }

    /** @return array<string, mixed> */
    private function post(string $path, array $body): array
    {
        try {
            $res = Http::withHeaders(['X-Auth-Secret' => (string) config('services.uber_auth.secret')])
                // A sign-in drives a real browser across several steps; give it room.
                ->timeout(90)
                ->asJson()
                ->post($this->baseUrl().$path, $body);

            $json = $res->json();

            return is_array($json) ? $json : ['status' => 'error', 'message' => 'bad_response'];
        } catch (\Throwable $e) {
            // Never surface credentials; a connection problem is just unavailable.
            return ['status' => 'error', 'message' => 'browser_service_unreachable'];
        }
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('services.uber_auth.url'), '/');
    }
}
