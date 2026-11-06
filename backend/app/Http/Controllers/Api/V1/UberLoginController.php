<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\PasswordlessLoginService;
use App\Domain\Dispatch\PasswordlessLoginSettings;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Passwordless Uber login (docs/27, variant A). Thin: the routes are already behind
 * the feature gate and `connections.manage`; everything else is the service. The
 * one-time code is validated, handed over and never touched again — not logged,
 * not echoed back.
 */
class UberLoginController extends Controller
{
    /** failure -> HTTP status; anything else is a normal 200 (the state says what happened). */
    private const FAILURE_HTTP = ['session_active' => 409, 'no_session' => 409, 'no_proxy' => 409, 'unavailable' => 503];

    public function __construct(
        private readonly PasswordlessLoginService $login,
        private readonly PasswordlessLoginSettings $settings,
        private readonly AuditLogger $audit,
    ) {}

    public function status(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->login->status($request->user()->tenant)]);
    }

    public function start(Request $request): JsonResponse
    {
        $tenant = $request->user()->tenant;
        // A full co-browse first connect asks for no email: the human types it into Uber themselves.
        $data = $request->validate([
            'email' => [$this->login->fullCobrowseAvailable($tenant) ? 'nullable' : 'required', 'email:rfc', 'max:255'],
            'mode' => ['sometimes', 'in:manual,auto'],
        ]);
        // Automatic (emailed code) by default for a company that set it up; the service
        // falls back to manual when it is not actually available.
        $mode = $data['mode'] ?? ($this->settings->autoCodeEnabled($tenant) ? 'auto' : 'manual');

        // A human pressing Connect is a deliberate reconnect: an admin "Stop session" only
        // blocks the AUTOMATIC paths, so it must not trap the company out of the capture.
        if ($tenant->isAutolinkBlocked()) {
            $tenant->unblockAutolink();
            $this->audit->log('fleet_session.autolink_unblocked_by_connect', null, ['user_id' => $request->user()->id]);
        }

        $result = $this->login->start($tenant, $data['email'] ?? '', $mode);

        // 202 = accepted, waiting for the code; any other outcome is a plain answer.
        return $this->respond($result, in_array($result['state'], ['awaiting_code', 'awaiting_challenge'], true) ? 202 : 200);
    }

    public function code(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'regex:/^\d{4}$/']]);

        return $this->respond($this->login->submitCode($request->user()->tenant, $data['code']));
    }

    public function cancel(Request $request): JsonResponse
    {
        return $this->respond($this->login->cancel($request->user()->tenant));
    }

    /** @param  array<string, mixed>  $result */
    private function respond(array $result, int $ok = 200): JsonResponse
    {
        $status = self::FAILURE_HTTP[$result['failure'] ?? ''] ?? $ok;

        return response()->json(['data' => $result], $status);
    }
}
