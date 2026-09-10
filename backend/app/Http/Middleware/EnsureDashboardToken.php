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
     * Ability => the only route URIs (Str::is patterns) a token holding it may
     * reach. A token holding none of these abilities is not confined here.
     */
    private const CONFINED_ABILITIES = [
        // Live session capture/status plus the browser-fed ingest endpoints.
        self::EXTENSION_ABILITY => [
            'api/v1/fleet-session',
            'api/v1/fleet-session/reconnect',
            'api/v1/fleet-session/report-broken',
            'api/v1/drivers/sync',
            'api/v1/drivers/roster',
            'api/v1/drivers/statuses',
            'api/v1/drivers/metrics',
            'api/v1/vehicles',
            'api/v1/dispatch/offers/ingest',
            'api/v1/supplier/capture',
        ],
        // The whole fleet-owner group of the driver app — read-only by design.
        self::FLEET_OWNER_ABILITY => [
            'api/v1/driver/fleet/*',
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

        $uri = $request->route()?->uri();

        foreach (self::CONFINED_ABILITIES as $ability => $allowed) {
            if (! $token->can($ability)) {
                continue;
            }

            abort_unless(Str::is($allowed, (string) $uri), 403, match ($ability) {
                self::EXTENSION_ABILITY => 'This token is limited to fleet-session ingest.',
                self::FLEET_OWNER_ABILITY => 'This token is limited to the fleet-owner app.',
                default => 'This token is limited to a narrower scope.',
            });
        }

        return $next($request);
    }
}
