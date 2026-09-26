<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Confines every scoped personal access token to the routes it was minted for.
 *
 * Two tokens are deliberately narrower than a dashboard session:
 *  - the browser extension (`fleet-session:write`, see ExtensionController) may
 *    only capture sessions and feed the ingest endpoints, so a leaked token can
 *    never read drivers/offers, delete data, or invite drivers;
 *  - the fleet-owner app token (`fleet:read`, see DriverAuthController) is
 *    obtained with an emailed 6-digit code and no password, so it must stay
 *    inside the read-only owner surface of the driver app and never reach the
 *    manager API it would otherwise share credentials-power with.
 *
 * SPA cookie sessions authenticate with a TransientToken and full-ability PATs
 * report '*', so both pass through untouched.
 */
class EnsureDashboardToken
{
    private const EXTENSION_ABILITY = 'fleet-session:write';

    private const FLEET_OWNER_ABILITY = 'fleet:read';

    /**
     * Ability => the only "METHOD uri" pairs (Str::is patterns) a token holding it
     * may reach. Method-aware on purpose: the URI alone let the extension token
     * DELETE /fleet-session (a full company purge) and GET /vehicles. A token
     * holding none of these abilities is not confined here. HEAD counts as GET.
     */
    private const CONFINED_ABILITIES = [
        // Live session capture/status plus the browser-fed ingest endpoints.
        self::EXTENSION_ABILITY => [
            'GET api/v1/fleet-session',
            'POST api/v1/fleet-session',
            'POST api/v1/fleet-session/report-broken',
            'POST api/v1/drivers/sync',
            'POST api/v1/drivers/roster',
            'POST api/v1/drivers/statuses',
            'POST api/v1/drivers/metrics',
            'POST api/v1/vehicles',
            'POST api/v1/dispatch/offers/ingest',
            'POST api/v1/supplier/capture',
        ],
        // The fleet-owner group of the driver app — read-only by design, plus the
        // owner's own profile, logout and push device.
        self::FLEET_OWNER_ABILITY => [
            'GET api/v1/driver/fleet/*',
            'PATCH api/v1/driver/fleet/me',
            'POST api/v1/driver/fleet/logout',
            'POST api/v1/driver/fleet/devices',
            'DELETE api/v1/driver/fleet/devices',
            'POST api/v1/driver/fleet/account/deletion-request',
        ],
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        // Only a real PAT narrower than '*' is constrained; TransientToken->can()
        // and full-ability tokens report '*'.
        if ($token === null || $token->can('*')) {
            return $next($request);
        }

        $method = $request->isMethod('HEAD') ? 'GET' : $request->getMethod();
        $target = $method.' '.$request->route()?->uri();

        foreach (self::CONFINED_ABILITIES as $ability => $allowed) {
            if (! $token->can($ability)) {
                continue;
            }

            abort_unless(Str::is($allowed, $target), 403, match ($ability) {
                self::EXTENSION_ABILITY => 'This token is limited to fleet-session ingest.',
                self::FLEET_OWNER_ABILITY => 'This token is limited to the fleet-owner app.',
                default => 'This token is limited to a narrower scope.',
            });
        }

        return $next($request);
    }
}
