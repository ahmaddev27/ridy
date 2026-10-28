<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin: drive the persistent session browser's interactive Uber sign-in for
 * a company. Two steps mirror the browser service: start (email + password) and mfa
 * (the SMS/OTP code). The password is relayed once and never stored. Used both for
 * the first setup and to recover a company after Uber forces a hard re-auth.
 */
class SessionBrowserLoginController extends Controller
{
    public function __construct(private readonly UberAuthClient $client) {}

    public function start(Request $request, Tenant $tenant): JsonResponse
    {
        if (! $this->client->configured()) {
            return response()->json(['data' => ['status' => 'unavailable', 'message' => 'browser_service_not_configured']], 503);
        }

        $data = $request->validate([
            'email' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $result = $this->client->startLogin($tenant, $data['email'], $data['password']);

        return response()->json(['data' => $this->publicResult($result)]);
    }

    public function mfa(Request $request, Tenant $tenant): JsonResponse
    {
        if (! $this->client->configured()) {
            return response()->json(['data' => ['status' => 'unavailable', 'message' => 'browser_service_not_configured']], 503);
        }

        $data = $request->validate([
            'login_id' => ['required', 'string', 'max:255'],
            'code' => ['required', 'string', 'max:16'],
        ]);

        $result = $this->client->submitMfa($data['login_id'], $data['code']);

        return response()->json(['data' => $this->publicResult($result)]);
    }

    /**
     * Only the fields the dashboard needs — never echo anything the service may
     * return beyond these (no cookies, no credentials).
     *
     * @param  array<string, mixed>  $result
     * @return array<string, string|null>
     */
    private function publicResult(array $result): array
    {
        return [
            'status' => (string) ($result['status'] ?? 'error'),
            'login_id' => isset($result['login_id']) ? (string) $result['login_id'] : null,
            'message' => isset($result['message']) ? (string) $result['message'] : null,
        ];
    }
}
