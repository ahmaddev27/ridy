<?php

namespace App\Http\Middleware;

use App\Support\Settings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks an authenticated driver whose company subscription is no longer active
 * (disabled / banned / expired). Guarding at login isn't enough — a driver with
 * a still-valid token would otherwise keep using the app after the company
 * lapses. The app treats this 403 as "log out / show subscription notice".
 */
class EnsureDriverTenantActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $reason = $request->user()?->loadMissing('tenant')->tenant?->stateReason();

        if ($reason !== null) {
            return response()->json([
                'message' => 'account_suspended',
                'reason' => $reason,
                'support_email' => Settings::get('support_email'),
                'support_whatsapp' => Settings::get('support_whatsapp'),
            ], 403);
        }

        return $next($request);
    }
}
