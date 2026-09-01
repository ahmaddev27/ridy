<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * TEMPORARY diagnostic: whenever a driver endpoint answers 401 (the recurring
 * "session_invalidated" cause), log at error level (so a raised LOG_LEVEL can't
 * hide it) exactly WHY — no bearer sent, a deleted token, an orphaned driver, or
 * a token that resolves fine yet the guard still rejects it. Handles both the
 * thrown AuthenticationException and any plain 401 response. Remove once the root
 * cause is confirmed.
 */
class LogDriverAuthContext
{
    public function handle(Request $request, Closure $next): Response
    {
        try {
            $response = $next($request);
        } catch (AuthenticationException $e) {
            $this->log($request);

            throw $e;
        }

        if ($response->getStatusCode() === 401) {
            $this->log($request);
        }

        return $response;
    }

    private function log(Request $request): void
    {
        if (! $request->is('api/v1/driver/*') || $request->is('api/v1/driver/fleet/*')) {
            return;
        }

        $bearer = $request->bearerToken();
        $pat = $bearer !== null && $bearer !== '' ? PersonalAccessToken::findToken($bearer) : null;

        // No token at all is an ordinary anonymous hit (app not signed in, or a poll
        // firing during logout) — not a server error, so don't flood the log with it.
        // The diagnostic only cares about a token that WAS sent yet rejected.
        if ($bearer === null || $bearer === '') {
            return;
        }

        $state = match (true) {
            $pat === null => 'token_not_found',
            $pat->tokenable === null => 'orphan_driver_deleted',
            default => 'resolves_ok_but_guard_rejected',
        };

        Log::error('driver_auth_401', [
            'path' => $request->path(),
            'token_state' => $state,
            'tokenable_type' => $pat?->tokenable_type,
            'tokenable_id' => $pat?->tokenable_id,
        ]);
    }
}
