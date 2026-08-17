<?php

namespace App\Http\Middleware;

use App\Domain\Dispatch\Models\UberFleetSession;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the browser-fed ingest endpoints (roster, statuses, vehicles, offers):
 * a company may only push data pulled from its OWN Uber account, and only after
 * it has connected (a stored session binds the company to its org). Without this
 * the extension's "Refresh from Uber" would import whatever Uber account the
 * manager happens to be signed into — bypassing connect and the one-account-per-
 * company rule.
 */
class EnsureFleetConnected
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $request->user()?->tenant;

        $connected = $tenant !== null && UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->exists();

        abort_unless($connected, 409, 'not_connected');

        return $next($request);
    }
}
