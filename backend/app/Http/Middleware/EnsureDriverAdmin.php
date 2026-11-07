<?php

namespace App\Http\Middleware;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\TenantContext;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admin capability for an owner who also drives: a Driver token whose row is
 * linked to a User that still holds an owner role in the SAME company. Re-read
 * per request. A lost capability answers 403 `admin_revoked` (never 401: the app
 * treats 401 on a Driver token as a dead session and signs out, whereas a demoted
 * owner-driver must simply fall back to the plain driver view).
 *
 * Pins the tenant context like EnsureDriverManager (a Driver token never passes
 * through ResolveTenant).
 */
class EnsureDriverAdmin
{
    public function __construct(private TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $driver = $request->user('driver');

        if (! $driver instanceof Driver || $driver->tenant_id === null) {
            throw new AuthenticationException('Unauthenticated.', ['driver']);
        }

        abort_unless($driver->adminCapable(), 403, 'admin_revoked');

        $this->context->set((int) $driver->tenant_id);

        return $next($request);
    }
}
