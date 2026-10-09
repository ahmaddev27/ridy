<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuse every El-Professor route for a company the platform has not opened.
 *
 * Closing a company **ends** its connection — `Tenant::setElprofessorEnabled(false)`
 * deletes the tokens, so the next read is already a 401 and this middleware
 * would rarely speak. It is here for the case that is worth being certain
 * about: a token that outlives a revocation by any path at all — a restore from
 * a backup, a row written by hand, a bug in a later release — must still reach
 * nothing. The flag is read per request, so it needs no deploy to take effect.
 *
 * It answers 403 with a stable reason rather than 401, because the credential
 * may be perfectly valid: what is withdrawn is the company's access to the
 * integration, and a caller that cannot tell those apart retries for ever.
 */
class EnsureElProfessorEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $request->user()?->tenant;

        if ($tenant === null || ! $tenant->elprofessorEnabled()) {
            return response()->json([
                'message' => 'The El-Professor integration is not enabled for this company.',
                'reason' => 'integration_disabled',
            ], 403);
        }

        return $next($request);
    }
}
