<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\UberAuthClient;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Interactive Uber sign-in for the fleet manager. Proxies to the Node uber-auth
 * service and, on success, stores the captured fleet session bound to the tenant.
 */
class UberLoginController extends Controller
{
    public function __construct(
        private UberAuthClient $auth,
        private FleetSessionService $sessions,
    ) {}

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        try {
            $result = $this->auth->start($data['email'], $data['password']);
        } catch (\Throwable $e) {
            return $this->authUnavailable();
        }

        return $this->respond($request, $result);
    }

    public function mfa(Request $request): JsonResponse
    {
        $data = $request->validate([
            'login_id' => ['required', 'string'],
            'code' => ['required', 'string'],
        ]);

        try {
            $result = $this->auth->submitMfa($data['login_id'], $data['code']);
        } catch (\Throwable $e) {
            return $this->authUnavailable();
        }

        return $this->respond($request, $result);
    }

    /**
     * The interactive-login service (uber-auth) is not run in production, where
     * Uber blocks datacenter logins anyway. Return a clean, actionable status
     * instead of a 500 so the UI points the user to the extension.
     */
    private function authUnavailable(): JsonResponse
    {
        return response()->json([
            'status' => 'service_unavailable',
            'message' => 'Der automatische Uber-Login ist hier nicht verfügbar. Bitte nutze die Ridy-Erweiterung.',
        ]);
    }

    /**
     * On success, persist the session; otherwise pass the status through so the
     * UI can show the MFA field or an error.
     *
     * @param  array<string, mixed>  $result
     */
    private function respond(Request $request, array $result): JsonResponse
    {
        $status = $result['status'] ?? 'error';

        if ($status === 'success') {
            $orgUuid = (string) ($result['org_uuid'] ?? '');
            $cookies = $result['cookies'] ?? [];

            if ($orgUuid === '' || $cookies === []) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Login succeeded but no session could be captured.',
                ]);
            }

            $this->sessions->capture(
                $request->user()->tenant,
                $orgUuid,
                $cookies,
                isset($result['expires_at']) ? CarbonImmutable::parse($result['expires_at']) : null,
            );

            return response()->json(['status' => 'success', 'org_uuid' => $orgUuid]);
        }

        // mfa_required | passkey_unsupported | bad_credentials | error — all are
        // expected flow states the UI drives on, so return 200 with the status.
        return response()->json([
            'status' => $status,
            'login_id' => $result['login_id'] ?? null,
            'retry' => $result['retry'] ?? false,
            'message' => $result['message'] ?? null,
        ]);
    }
}
