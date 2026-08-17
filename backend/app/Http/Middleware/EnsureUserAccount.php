<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The `auth:sanctum` guard resolves ANY personal-access-token holder — including
 * a mobile Driver token. The manager dashboard must be reachable only by real
 * User accounts, so this rejects a Driver (or any non-User) token before it can
 * reach manager-scoped endpoints. Prevents a driver's app token from acting as
 * a tenant manager.
 */
class EnsureUserAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($request->user() instanceof User, 403, 'Forbidden.');

        return $next($request);
    }
}
