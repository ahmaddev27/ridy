<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the internal dispatch-ingest endpoint. The Node daemon is the only
 * caller and authenticates with a shared secret, not a user session.
 */
class VerifyDispatchSecret
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.dispatch.ingest_secret');
        $provided = (string) $request->header('X-Dispatch-Secret', '');

        // A blank configured secret must never accidentally allow access.
        if ($expected === '' || ! hash_equals($expected, $provided)) {
            abort(401, 'Invalid dispatch secret.');
        }

        return $next($request);
    }
}
