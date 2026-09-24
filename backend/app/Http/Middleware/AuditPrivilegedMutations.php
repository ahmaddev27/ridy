<?php

namespace App\Http\Middleware;

use App\Domain\Audit\AuditLogger;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Writes an audit entry for every successful mutating request (POST/PUT/PATCH/
 * DELETE) on the super-admin API (/api/v1/admin/*), or made while a super-admin
 * is acting as a company. Those are the actions with platform-wide blast radius (company
 * deletes, subscription grants, queue flushes, broadcasts, settings) and, during
 * impersonation, actions otherwise attributed to the impersonated manager.
 *
 * Appended to the `api` group so new admin routes are covered automatically.
 * Controllers that write a richer explicit entry flag the request and are skipped.
 * Request input is recorded with secrets redacted.
 */
class AuditPrivilegedMutations
{
    private const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

    /** Input keys whose values never enter the audit log. */
    private const REDACT = '/pass|token|secret|cookie|otp|code|key|url|auth|session|iban|bic|sdp|credential/i';

    public function __construct(private readonly AuditLogger $audit) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        try {
            if ($this->shouldAudit($request, $response)) {
                $this->record($request, $response);
            }
        } catch (Throwable $e) {
            report($e); // auditing must never break the response
        }

        return $response;
    }

    private function shouldAudit(Request $request, Response $response): bool
    {
        if (! in_array($request->method(), self::MUTATING, true)) {
            return false;
        }
        if ($response->getStatusCode() < 200 || $response->getStatusCode() >= 300) {
            return false;
        }
        if ($request->attributes->get(AuditLogger::REQUEST_FLAG)) {
            return false;
        }

        // The admin prefix is reachable only by super-admins (its route group enforces
        // it), so a successful response there IS a super-admin action — no role query
        // on the hot ingest POSTs that also pass through this group.
        return $request->is('api/v1/admin/*')
            || ($request->hasSession() && $request->session()->has('impersonator_id'));
    }

    private function record(Request $request, Response $response): void
    {
        $route = $request->route();
        $action = $route?->getName() ?: ($route?->getActionName() ?? 'request');
        $action = str_replace('App\\Http\\Controllers\\Api\\V1\\', '', $action);

        $subject = null;
        $params = [];
        foreach ($route?->parameters() ?? [] as $name => $value) {
            if ($value instanceof Model) {
                $subject ??= $value;
                $params[$name] = $value->getKey();
            } elseif (is_scalar($value)) {
                $params[$name] = $value;
            }
        }

        $context = [
            'method' => $request->method(),
            'path' => $request->path(),
            'status' => $response->getStatusCode(),
            'params' => $params ?: null,
            'input' => $this->redact($request->except(['_token'])) ?: null,
        ];

        $impersonating = $request->hasSession() && $request->session()->has('impersonator_id');

        // Super-admin actions are platform entries (tenant_id NULL) so they survive
        // a company delete; impersonated actions belong to the company acted on.
        $impersonating
            ? $this->audit->log($action, $subject, array_filter($context, fn ($v) => $v !== null))
            : $this->audit->logPlatform($action, $subject, array_filter($context, fn ($v) => $v !== null));
    }

    /**
     * @param  array<mixed>  $input
     * @return array<mixed>
     */
    private function redact(array $input, int $depth = 0): array
    {
        $out = [];
        foreach (array_slice($input, 0, 50, true) as $key => $value) {
            if (is_string($key) && preg_match(self::REDACT, $key)) {
                $out[$key] = '[redacted]';
            } elseif (is_array($value)) {
                $out[$key] = $depth < 2 ? $this->redact($value, $depth + 1) : '[…]';
            } elseif (is_string($value)) {
                $out[$key] = mb_substr($value, 0, 200);
            } elseif (is_scalar($value) || $value === null) {
                $out[$key] = $value;
            } else {
                $out[$key] = '[file]';
            }
        }

        return $out;
    }
}
