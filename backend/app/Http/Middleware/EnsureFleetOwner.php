<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The fleet-owner surface of the driver app (/driver/fleet/*) is tenant-wide, so
 * the owner check lives in ONE place instead of each FleetController method
 * remembering it: a tenant-bound User who still holds an app-eligible role. A
 * user demoted after signing in loses access even with their old app token.
 */
class EnsureFleetOwner
{
    /** Roles allowed to sign into the driver app in owner mode (see DriverAuthController). */
    public const ROLES = ['fleet_manager', 'owner'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        abort_unless(
            $user instanceof User && $user->tenant_id !== null && $user->hasAnyRole(self::ROLES),
            403,
            'fleet_owner_only',
        );

        return $next($request);
    }
}
