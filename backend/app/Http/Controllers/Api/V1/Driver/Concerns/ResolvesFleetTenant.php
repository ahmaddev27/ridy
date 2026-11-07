<?php

namespace App\Http\Controllers\Api\V1\Driver\Concerns;

use App\Domain\Fleet\Models\Driver;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The company a fleet-wide request acts on, for either caller the shared fleet
 * controllers serve: a tenant-bound owner/manager `User` (`/driver/fleet/*`) or an
 * admin-capable `Driver` that passed `driver.admin` (`/driver/admin/*`). Anything
 * else is 403 `fleet_owner_only`. The tenant is always the caller's own, never
 * read from the request.
 */
trait ResolvesFleetTenant
{
    protected function fleetTenantId(Request $request): int
    {
        $caller = $request->user();

        if ($caller instanceof Driver) {
            abort_unless($caller->tenant_id !== null && $caller->adminCapable(), 403, 'fleet_owner_only');

            return (int) $caller->tenant_id;
        }

        abort_unless($caller instanceof User && $caller->tenant_id !== null, 403, 'fleet_owner_only');

        return (int) $caller->tenant_id;
    }
}
