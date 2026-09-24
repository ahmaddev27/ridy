<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
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

        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        if (! $user->hasAnyRole(self::ROLES)) {
            $this->signOutDemoted($user);
        }

        return $next($request);
    }

    /**
     * An owner demoted after signing in: their app session is over. Answer 401
     * (and drop the bearer token) — every app build treats 401 as "signed out"
     * and shows the login screen, whereas a 403 left app 1.0.4 stuck on its
     * offline screen.
     */
    private function signOutDemoted(User $user): never
    {
        $token = $user->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        throw new AuthenticationException('fleet_owner_only');
    }
}
