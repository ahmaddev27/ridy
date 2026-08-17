<?php

namespace App\Domain\Tenancy;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Wipes a company's operational fleet data — its Uber session(s), drivers,
 * vehicles, dispatch offers, device tokens and driver metrics — so it can start
 * over from a clean re-link. Also frees its residential proxy back to the pool
 * (no drivers left to route) and blocks the extension's silent auto-relink until
 * the manager explicitly reconnects. Deliberately KEEPS the tenant, its users
 * and its billing history: a full company deletion is a separate action.
 */
class CompanyDataPurger
{
    public function __construct(private readonly ProxyPool $proxies) {}

    /**
     * @return array<string, int> rows deleted per entity
     */
    public function purge(Tenant $tenant): array
    {
        return DB::transaction(function () use ($tenant) {
            $id = $tenant->id;

            // Children first (device tokens + metrics reference a driver), then
            // the parents. All scoped to the tenant, global scope bypassed so an
            // admin acting without tenant context still hits the rows.
            $counts = [
                'device_tokens' => DeviceToken::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
                'driver_metrics' => DriverMetric::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
                'offers' => DispatchOffer::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
                'vehicles' => Vehicle::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
                'drivers' => Driver::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
                'sessions' => UberFleetSession::withoutGlobalScopes()->where('tenant_id', $id)->delete(),
            ];

            // Free the proxy slot (no drivers left), unbind the Uber org (so a
            // stray offer for that org can never be re-attributed to this now-
            // disconnected company), and stop the extension from silently
            // re-capturing the session the operator just cut.
            $this->proxies->release($tenant);
            $tenant->forceFill(['uber_org_uuid' => null])->save();
            $tenant->blockAutolink();

            return $counts;
        });
    }
}
