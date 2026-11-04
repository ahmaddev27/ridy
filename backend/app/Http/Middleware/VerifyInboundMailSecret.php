<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shared-secret gate for the inbound-mail webhook. SendGrid Inbound Parse can only be
 * pointed at a URL, so the secret rides as `?token=` (a header is accepted too for other
 * relays). Constant-time compare; a blank configured secret rejects everything.
 */
class VerifyInboundMailSecret
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.inbound_mail.webhook_secret');
        $provided = (string) ($request->header('X-Inbound-Secret') ?: $request->query('token', ''));

        if ($expected === '' || ! hash_equals($expected, $provided)) {
            Log::warning('inbound_mail_webhook_rejected', ['ip' => $request->ip()]);

            return response()->json(['message' => 'Unauthorized.'], 401);
        }

        return $next($request);
    }
}
