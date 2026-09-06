<?php

namespace App\Http\Middleware;

use App\Support\Settings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Hard-blocks an authenticated manager whose company an admin has BANNED or
 * DISABLED — abuse actions after which a still-valid SPA/remember-me session must
 * not keep driving the dashboard API (list/modify drivers, delete offers, invite,
 * link Uber, …); enforcement was previously client-side only.
 *
 * A mere billing lapse ('expired'/'inactive') is deliberately NOT blocked here:
 * the app lets that manager keep viewing their dashboard and redeem a code to
 * reactivate — only Uber ingest is gated for them (via {@see EnsureFleetConnected}).
 * The manager counterpart to {@see EnsureDriverTenantActive}, but narrower on
 * purpose. Super-admins carry no tenant and never reach this middleware.
 */
class EnsureUserTenantActive
{
    /** @var list<string> stateReason() values that hard-block the manager surface. */
    private const BLOCKED_REASONS = ['banned', 'disabled'];

    public function handle(Request $request, Closure $next): Response
    {
        $reason = $request->user()?->loadMissing('tenant')->tenant?->stateReason();

        if ($reason !== null && in_array($reason, self::BLOCKED_REASONS, true)) {
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
