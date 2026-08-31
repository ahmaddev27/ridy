<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps the scoped browser-extension token out of dashboard endpoints.
 *
 * The extension PAT is minted with only the `fleet-session:write` ability (see
 * ExtensionController). It must reach nothing beyond the session-capture / ingest
 * routes listed below; this guard 403s it on every other manager route — so a
 * leaked extension token can never read drivers/offers, delete data, or invite
 * drivers. SPA cookie sessions authenticate with a TransientToken (all abilities)
 * and are unaffected, as are any full-ability PATs.
 */
class EnsureDashboardToken
{
    private const EXTENSION_ABILITY = 'fleet-session:write';

    /**
     * The only routes (by URI) the extension token may reach: live session
     * capture/status plus the browser-fed ingest endpoints.
     */
    private const ALLOWED_URIS = [
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
        'api/v1/supplier/timeline',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        // Only a real PAT scoped to the extension ability (and nothing wider) is
        // constrained; TransientToken->can() and full-ability tokens report '*'.
        $isExtensionToken = $token !== null
            && ! $token->can('*')
            && $token->can(self::EXTENSION_ABILITY);

        if ($isExtensionToken) {
            abort_unless(
                in_array($request->route()?->uri(), self::ALLOWED_URIS, true),
                403,
                'This token is limited to fleet-session ingest.',
            );
        }

        return $next($request);
    }
}
