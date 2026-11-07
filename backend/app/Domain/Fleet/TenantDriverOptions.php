<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\Driver;
use Illuminate\Support\Collection;

/**
 * A company's drivers as id + name, for pickers. Shared by the fleet-owner app
 * (User token) and the driver app's manager mode (Driver token): both pass the
 * tenant explicitly, so neither depends on a request tenant context.
 */
class TenantDriverOptions
{
    /** @return Collection<int, Driver> */
    public function forTenant(int $tenantId): Collection
    {
        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->orderBy('name')
            ->get(['id', 'name']);
    }

    /**
     * The same picker for an owner who also drives: each row gains `is_me` (the
     * driver linked to `$userId`) and that row sorts first.
     *
     * @return Collection<int, array{id: int, name: string, is_me: bool}>
     */
    public function forTenantMarking(int $tenantId, int $userId): Collection
    {
        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->orderBy('name')
            ->get(['id', 'name', 'user_id'])
            ->map(fn (Driver $d) => ['id' => $d->id, 'name' => $d->name, 'is_me' => (int) $d->user_id === $userId])
            ->sortByDesc('is_me')
            ->values();
    }
}
