<?php

namespace App\Http\Middleware;

use App\Domain\Fleet\Models\Driver;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Belt and braces behind `auth:driver`: the driver-app routes filter every query
 * on `driver_id = user()->id`, so anything but a Driver (a dashboard User whose
 * id happens to match a foreign driver) must never get through. The guard itself
 * is bearer-only + Driver-provider; this keeps the invariant if it ever drifts.
 */
class EnsureDriverAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user('driver') instanceof Driver) {
            throw new AuthenticationException('Unauthenticated.', ['driver']);
        }

        return $next($request);
    }
}
