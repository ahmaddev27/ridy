<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * TEMPORARY diagnostic: logs exactly why a driver request would fail auth, so the
 * recurring "session_invalidated" 401 on /driver/home can be pinned to a cause —
 * a deleted token vs. a token whose driver row is gone (orphan). Runs BEFORE the
 * auth:driver guard and only when a bearer token is present. Remove once the
 * root cause is confirmed.
 */
class LogDriverAuthContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $bearer = $request->bearerToken();
        if ($bearer !== null && $bearer !== '') {
            $pat = PersonalAccessToken::findToken($bearer);
            if ($pat === null) {
                Log::warning('driver_auth_debug', [
                    'result' => 'token_not_found',
                    'path' => $request->path(),
                    'prefix' => substr($bearer, 0, 12),
                ]);
            } elseif ($pat->tokenable === null) {
                Log::warning('driver_auth_debug', [
                    'result' => 'tokenable_missing',
                    'path' => $request->path(),
                    'token_id' => $pat->id,
                    'tokenable_type' => $pat->tokenable_type,
                    'tokenable_id' => $pat->tokenable_id,
                ]);
            }
            // A token that resolves fine but still 401s would point at the guard.
        }

        return $next($request);
    }
}
