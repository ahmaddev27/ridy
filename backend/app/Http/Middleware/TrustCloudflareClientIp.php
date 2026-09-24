<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\IpUtils;
use Symfony\Component\HttpFoundation\Response;

/**
 * Behind Cloudflare the proxy chain is client → Cloudflare edge → Caddy → PHP.
 * Caddy doesn't trust Cloudflare, so the forwarded client address Laravel sees
 * is a Cloudflare EDGE IP — every visitor shared one per-IP login/OTP throttle
 * and access logs recorded Cloudflare. When (and only when) the resolved peer is
 * a Cloudflare address, the visitor's real IP is taken from CF-Connecting-IP,
 * which Cloudflare always overwrites. A direct hit on the origin comes from a
 * non-Cloudflare address, so a spoofed header there is ignored.
 *
 * Runs after TrustProxies (global, appended). A no-op once Caddy itself trusts
 * the Cloudflare ranges (the peer is then already the real client).
 */
class TrustCloudflareClientIp
{
    /**
     * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
     * Refresh if Cloudflare announces changes (rare).
     */
    public const RANGES = [
        '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
        '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
        '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
        '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
        '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
        '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $peer = (string) $request->ip();
        $client = trim((string) $request->headers->get('CF-Connecting-IP', ''));

        if ($client !== ''
            && filter_var($client, FILTER_VALIDATE_IP) !== false
            && IpUtils::checkIp($peer, self::RANGES)) {
            // TrustProxies trusts the immediate hop (Caddy), so the forwarded-for
            // value becomes $request->ip() for throttles, logs and audit rows.
            $request->headers->set('X-Forwarded-For', $client);
        }

        return $next($request);
    }
}
