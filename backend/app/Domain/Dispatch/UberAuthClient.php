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
    public function startLogin(Tenant $tenant, string $email, bool $cold = false, bool $cobrowse = false, bool $full = false): array
    {
        return $this->post('/login/start', [
            // A full co-browse start types nothing: the human enters their own email in the stream.
            'email' => $email,
            'company_key' => (string) $tenant->id,
            'proxy_url' => $tenant->getAttribute('proxy_url') ?: null,
            // First connect, nothing to ride: uber-auth opens a fresh browser through the proxy.
            'cold' => $cold,
        ] + ($cobrowse ? ['cobrowse' => true] : []) + ($full ? ['full' => true] : []), timeout: 90);
    }

    /**
     * Long-poll for the puzzle outcome (docs/28 §3.2). uber-auth waits up to 25 s; we cap
     * the call short so a status poll never pins a worker (a timeout reads as `pending`).
     *
     * @return array<string, mixed>
     */
    public function resume(Tenant $tenant, string $loginId): array
    {
        return $this->post('/login/resume', [
            'login_id' => $loginId,
            'company_key' => (string) $tenant->id,
        ], timeout: 4);
    }

    /** Stop the co-browse stream (the login itself is cancelled separately). @return array<string, mixed> */
    public function closeCobrowse(Tenant $tenant, ?string $loginId = null): array
    {
        return $this->post('/cobrowse/close', array_filter([
            'company_key' => (string) $tenant->id,
            'login_id' => $loginId,
        ], fn ($v) => $v !== null), timeout: 15);
    }

    /** @return array<string, mixed> */
    public function submitMfa(Tenant $tenant, string $loginId, string $code): array
    {
        // 50s, not 30: uber-auth's post-code detectStep budget is ~38s (stepTimeout 30 + the 8s
        // arkose last-chance). At 30 the backend aborted mid-submit, so the attempt hung in
        // `submitting` while uber-auth was still polling. The window must exceed detectStep.
        return $this->post('/login/mfa', [
            'login_id' => $loginId,
            'code' => $code,
            'company_key' => (string) $tenant->id,
        ], timeout: 50);
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
     * Admin force re-link only: stop the company's persistent browser even when it is ACTIVE.
     * Answers {ok:true,state} on success, {status:'error'|'pending'} otherwise.
     *
     * @return array<string, mixed>
     */
    public function dropSession(Tenant $tenant): array
    {
        return $this->post('/session/drop', ['company_key' => (string) $tenant->id], timeout: 15);
    }

    /**
     * Ask uber-auth to register a software passkey on the company's Uber account (docs/29).
     * The credential goes straight to the internal passkey endpoint, never through here.
     *
     * @return array<string, mixed>
     */
    public function registerPasskey(int $tenantId): array
    {
        return $this->post('/passkey/register', ['company_key' => (string) $tenantId], timeout: 120);
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
