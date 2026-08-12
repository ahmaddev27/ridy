<?php

namespace App\Http\Middleware;

use App\Domain\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the active tenant from the authenticated user and seeds TenantContext.
 * Applied to authenticated API routes.
 */
class ResolveTenant
{
    public function __construct(private TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = Auth::user();

        if ($user && $user->tenant_id) {
            $this->context->set((int) $user->tenant_id);

            return $next($request);
        }

        // A user with no tenant (e.g. a reseller) must NEVER reach tenant-scoped
        // routes: with no tenant context the global scope no-ops and would leak
        // every company's data. Only the super-admin is cross-tenant by design.
        if ($user && $user->hasRole('super_admin')) {
            return $next($request);
        }

        abort(403, 'no_tenant');
    }
}
