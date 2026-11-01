<?php

namespace App\Domain\Dispatch;

use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Thin client for the uber-auth service (the persistent session-browser process).
 * The dashboard drives a passwordless Uber sign-in through here: the backend alone
 * holds the service's X-Auth-Secret. The one-time code is relayed for a SINGLE
 * sign-in and is never stored or logged; on success uber-auth keeps the browser per
 * company and pushes the capture + status back to our internal endpoints.
 *
 * Every method returns uber-auth's decoded JSON, or a bare {status: error} when the
 * service is down / answered garbage — never an exception, never raw error text.
 */
class UberAuthClient
{
    public function configured(): bool
    {
        return $this->baseUrl() !== '' && (string) config('services.uber_auth.secret') !== '';
    }

    /**
     * Begin a login for a company. company_key = tenant id, so the browser the service
     * adopts is bound to this tenant. The company's own residential proxy travels
     * along so the login comes from the same IP as the rest of its session.
     *
     * @return array<string, mixed>
     */
    public function startLogin(Tenant $tenant, string $email): array
    {
        return $this->post('/login/start', [
            'email' => $email,
            'company_key' => (string) $tenant->id,
            'proxy_url' => $tenant->getAttribute('proxy_url') ?: null,
        ], timeout: 90);
    }

    /** @return array<string, mixed> */
    public function submitMfa(Tenant $tenant, string $loginId, string $code): array
    {
        return $this->post('/login/mfa', [
            'login_id' => $loginId,
            'code' => $code,
            'company_key' => (string) $tenant->id,
        ], timeout: 30);
    }

    /** @return array<string, mixed> */
    public function cancel(Tenant $tenant, string $loginId): array
    {
        return $this->post('/login/cancel', [
            'login_id' => $loginId,
            'company_key' => (string) $tenant->id,
        ], timeout: 15);
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    private function post(string $path, array $body, int $timeout): array
    {
        try {
            $res = Http::withHeaders(['X-Auth-Secret' => (string) config('services.uber_auth.secret')])
                ->timeout($timeout)
                ->asJson()
                ->post($this->baseUrl().$path, $body);

            $json = $res->json();

            return is_array($json) ? $json : ['status' => 'error', 'message' => 'bad_response'];
        } catch (ConnectionException $e) {
            // A timeout is NOT a failure: uber-auth may still be driving the login (or have
            // sent the code). Report it as pending so the caller waits instead of racing it.
            if (stripos($e->getMessage(), 'timed out') !== false || stripos($e->getMessage(), 'error 28') !== false) {
                return ['status' => 'pending'];
            }

            return ['status' => 'error', 'message' => 'browser_service_unreachable'];
        } catch (\Throwable) {
            // Deliberately no message: a transport error could echo the request.
            return ['status' => 'error', 'message' => 'browser_service_unreachable'];
        }
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('services.uber_auth.url'), '/');
    }
}
