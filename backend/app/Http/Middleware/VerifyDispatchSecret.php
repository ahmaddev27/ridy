<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\IpUtils;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the internal dispatch endpoints. The Node daemon is the only caller and
 * authenticates with a shared secret, not a user session. These endpoints hand
 * out every company's Uber cookies, so two extra layers: an optional source-IP
 * allowlist (DISPATCH_ALLOWED_IPS, IPs or CIDRs — empty = any IP, the previous
 * behaviour) and a warning log for every rejected call so a leaked-secret probe
 * is visible.
 */
class VerifyDispatchSecret
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.dispatch.ingest_secret');
        $provided = (string) $request->header('X-Dispatch-Secret', '');

        // A blank configured secret must never accidentally allow access.
        if ($expected === '' || ! hash_equals($expected, $provided)) {
            $this->reject($request, 'bad_secret');
        }

        $allowed = array_values(array_filter((array) config('services.dispatch.allowed_ips', [])));
        if ($allowed !== [] && ! IpUtils::checkIp((string) $request->ip(), $allowed)) {
            $this->reject($request, 'ip_not_allowed');
        }

        return $next($request);
    }

    private function reject(Request $request, string $reason): never
    {
        Log::warning('dispatch_secret_rejected', [
            'reason' => $reason,
            'path' => $request->path(),
            'ip' => $request->ip(),
        ]);

        abort(401, 'Invalid dispatch secret.');
    }
}
