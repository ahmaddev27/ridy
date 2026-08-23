<?php

namespace App\Http\Controllers\Concerns;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/**
 * Defense-in-depth tenant ownership guard for route-model-bound resources.
 *
 * The global TenantScope already scopes implicit bindings once ResolveTenant has
 * run (see the middleware priority in bootstrap/app.php), but binding-time scoping
 * is fragile: any future middleware-order regression would silently re-open a
 * cross-tenant IDOR. This makes the ownership check explicit at the point of use
 * so a bound model can never act on another tenant's row, and returns 404 (not
 * 403) so a foreign id is indistinguishable from a non-existent one.
 */
trait AuthorizesTenantResource
{
    protected function authorizeTenant(Model $model): void
    {
        $user = request()->user();
        $tenantId = $user?->tenant_id;

        // Only tenant-owned models carry the column; a mismatch (or a caller with
        // no tenant) is treated as "not found" rather than leaking existence.
        abort_unless(
            $tenantId !== null
                && in_array(BelongsToTenant::class, class_uses_recursive($model), true)
                && (int) $model->getAttribute('tenant_id') === (int) $tenantId,
            404,
        );
    }
}
