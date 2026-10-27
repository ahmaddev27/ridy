<?php

namespace App\Http\Middleware;

use App\Http\Controllers\Api\V1\Admin\ImpersonationController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses a request made while a super-admin is acting as a company. Mounted on
 * anything that changes HOW an account signs in — a passkey enrolled during
 * impersonation would be a permanent back door into the manager's account that
 * survives the impersonation ending, and the manager would never have made it.
 * Same rule, same code, as the credential fields of `PUT profile`.
 */
class EnsureNotImpersonating
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_if(
            $request->hasSession() && $request->session()->has(ImpersonationController::KEY),
            403,
            'impersonation_forbidden',
        );

        return $next($request);
    }
}
