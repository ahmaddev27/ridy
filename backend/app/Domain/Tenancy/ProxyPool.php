<?php

namespace App\Domain\Tenancy;

use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;

/**
 * Assigns companies to residential proxies from the shared pool. A company keeps
 * its proxy until deleted; slots are counted by *usable* companies, so a
 * disabled/expired company frees its slot automatically without being detached.
 */
class ProxyPool
{
    /**
     * Ensure the tenant sits on a proxy that still has a free slot. Keeps its
     * current proxy when that one has room; otherwise moves it to the least-loaded
     * proxy with capacity. No-op (returns null) when the pool is empty/full —
     * the tenant then falls back to the global proxy.
     */
    public function assign(Tenant $tenant): ?Proxy
    {
        $current = $tenant->proxy_id !== null ? Proxy::find($tenant->proxy_id) : null;
        if ($current !== null && $current->hasFreeSlot()) {
            return $current; // already well-placed
        }

        $target = $this->leastLoadedWithCapacity($tenant->id);
        if ($target === null) {
            return null;
        }

        $tenant->forceFill(['proxy_id' => $target->id, 'proxy_url' => $target->url])->save();

        return $target;
    }

    /** Detach the tenant from its proxy (on delete). */
    public function release(Tenant $tenant): void
    {
        $tenant->forceFill(['proxy_id' => null, 'proxy_url' => null])->save();
    }

    /** The proxy with the most free slots, or null if none has room. */
    private function leastLoadedWithCapacity(int $exceptTenantId): ?Proxy
    {
        return Proxy::all()
            ->filter(fn (Proxy $p) => $p->usedCount() < $p->capacity)
            ->sortByDesc(fn (Proxy $p) => $p->capacity - $p->usedCount())
            ->first();
    }
}
