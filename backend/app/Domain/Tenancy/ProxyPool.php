<?php

namespace App\Domain\Tenancy;

use App\Domain\Tenancy\Models\Proxy;
use App\Domain\Tenancy\Models\Tenant;

/**
 * Assigns companies to residential proxies from the shared pool. A company keeps
 * its proxy until deleted; capacity is measured in DRIVERS of *usable* companies,
 * so a disabled/expired company frees its load automatically without being
 * detached.
 *
 * `tenants.proxy_url` is a copy of the assigned proxy's URL (the daemon reads it);
 * it is encrypted at rest and kept in sync when a pool proxy is edited or deleted
 * ({@see syncTenantsOf()}, {@see remove()}).
 */
class ProxyPool
{
    /**
     * Ensure the tenant sits on a proxy with room for it. Keeps its current proxy
     * unless the OTHER companies on it already fill it — the tenant's own drivers
     * never count against it, so a renewal can't bounce a working company onto a
     * new residential IP mid-session. Otherwise moves it to the least-loaded proxy
     * that fits its drivers. No-op (returns null) when the pool is empty/full —
     * the tenant then falls back to the global proxy.
     */
    public function assign(Tenant $tenant): ?Proxy
    {
        $current = $tenant->proxy_id !== null ? Proxy::find($tenant->proxy_id) : null;
        if ($current !== null && $current->usedCount($tenant->id) < $current->capacity) {
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

    /** A pool proxy's URL/credentials changed: every assigned company gets the new one. */
    public function syncTenantsOf(Proxy $proxy): int
    {
        $tenants = Tenant::where('proxy_id', $proxy->id)->get();
        foreach ($tenants as $tenant) {
            $tenant->forceFill(['proxy_url' => $proxy->url])->save();
        }

        return $tenants->count();
    }

    /**
     * Delete a pool proxy: detach its companies (so the daemon stops using the
     * deleted credentials), delete it, then re-place the usable ones on another
     * proxy — after the delete, so none can land back on the dying one.
     */
    public function remove(Proxy $proxy): void
    {
        $tenants = Tenant::where('proxy_id', $proxy->id)->get();
        foreach ($tenants as $tenant) {
            $this->release($tenant);
        }

        $proxy->delete();

        foreach ($tenants as $tenant) {
            if ($tenant->isUsable()) {
                $this->assign($tenant);
            }
        }
    }

    /**
     * The proxy with the most free room (measured without this tenant's own
     * drivers), or null if none has room. One usedCount() per proxy.
     */
    private function leastLoadedWithCapacity(int $exceptTenantId): ?Proxy
    {
        return Proxy::all()
            ->map(fn (Proxy $p) => ['proxy' => $p, 'free' => $p->capacity - $p->usedCount($exceptTenantId)])
            ->filter(fn (array $row) => $row['free'] > 0)
            ->sortByDesc('free')
            ->first()['proxy'] ?? null;
    }
}
