<?php

namespace App\Http\Middleware;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\TenantContext;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Manager mode for the driver app: a Driver token whose `is_manager` flag is set.
 * The flag is read from the freshly authenticated model on EVERY request, so a
 * demotion takes effect on the very next call. Anything else gets a 401, which
 * makes a demoted manager's app fall back to the plain driver experience.
 *
 * Also pins the tenant context to the driver's company: a Driver token never
 * passes through ResolveTenant, and an unset context would make every tenant
 * global scope a no-op.
 */
class EnsureDriverManager
{
    public function __construct(private TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $driver = $request->user('driver');

        if (! $driver instanceof Driver || $driver->is_manager !== true || $driver->tenant_id === null) {
            throw new AuthenticationException('Unauthenticated.', ['driver']);
        }

        $this->context->set((int) $driver->tenant_id);

        return $next($request);
    }
}
