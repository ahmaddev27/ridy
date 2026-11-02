<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\PasswordlessLoginService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Co-browse for Uber's Arkose puzzle (docs/28). Thin: the routes sit behind the co-browse
 * gate (404 when off) and `connections.manage`. The response carries the one-minute stream
 * ticket and the websocket url - never the login_id or any cookie.
 */
class UberLoginCobrowseController extends Controller
{
    /** service error -> [HTTP status, error code] */
    private const ERRORS = [
        'not_in_challenge' => [409, 'not_in_challenge'],
        'too_many' => [429, 'too_many_tickets'],
        'busy' => [429, 'busy'],
        'unavailable' => [503, 'cobrowse_unavailable'],
    ];

    public function __construct(private readonly PasswordlessLoginService $login) {}

    public function open(Request $request): JsonResponse
    {
        $user = $request->user();
        $result = $this->login->mintCobrowseTicket($user->tenant, $user->id);

        if (isset($result['error'])) {
            [$status, $code] = self::ERRORS[$result['error']] ?? self::ERRORS['unavailable'];

            return response()->json(['message' => $code, 'error' => $code], $status);
        }

        return response()->json(['data' => [
            'ws_url' => $this->wsUrl(),
            'ticket' => $result['ticket'],
            'expires_at' => $result['expires_at'],
            'viewport' => ['w' => 1280, 'h' => 800],
            'session_ttl' => (int) config('services.passwordless_login.cobrowse_session_ttl'),
        ]], 201);
    }

    public function close(Request $request): JsonResponse
    {
        $view = $this->login->cancelCobrowse($request->user()->tenant);

        return response()->json(['data' => ['state' => $view['state']]]);
    }

    private function wsUrl(): string
    {
        $configured = (string) config('services.passwordless_login.cobrowse_ws_url');
        if ($configured !== '') {
            return $configured;
        }

        return 'wss://'.parse_url((string) config('app.url'), PHP_URL_HOST).'/cobrowse/ws';
    }
}
