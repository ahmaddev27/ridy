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
 * over from a clean re-link. Deliberately KEEPS the tenant, its users and its
 * billing history (subscription / collector payments): a full company deletion
 * is a separate, more destructive action.
 */
class CompanyDataPurger
{
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

            return $counts;
        });
    }
}
