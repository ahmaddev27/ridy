<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the platform-owner (super-admin) API. Deliberately paired WITHOUT
 * ResolveTenant so the request leaves the tenant context empty — the global
 * TenantScope then no-ops and the super-admin can read/write across companies.
 */
class EnsureSuperAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(Auth::user()?->hasRole('super_admin'), 403, 'Super-admin only.');

        return $next($request);
    }
}
