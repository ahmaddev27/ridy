<?php

namespace App\Domain\Tenancy;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Support\BatchDelete;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Wipes a company's operational fleet data — its Uber session(s), drivers,
 * vehicles, dispatch offers, device tokens and driver metrics — so it can start
 * over from a clean re-link. Also frees its residential proxy back to the pool
 * (no drivers left to route) and blocks the extension's silent auto-relink until
 * the manager explicitly reconnects. Deliberately KEEPS the tenant, its users
 * and its billing history: a full company deletion is a separate action.
 *
 * Two phases: a short transaction first cuts the connection (session rows,
 * proxy, org binding, autolink block) so the stream stops immediately; then the
 * bulk rows go in id-bounded batches. A mature tenant's offer history used to be
 * deleted in ONE transaction that held locks for minutes. Re-running is safe: it
 * just deletes whatever is left.
 */
class CompanyDataPurger
{
    private const BATCH = 2000;

    public function __construct(
        private readonly ProxyPool $proxies,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * @return array<string, int> rows deleted per entity
     */
    public function purge(Tenant $tenant): array
    {
        $id = $tenant->id;

        $sessions = DB::transaction(function () use ($tenant, $id) {
            $deleted = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $id)->delete();

            // Free the proxy slot (no drivers left), unbind the Uber org (so a
            // stray offer for that org can never be re-attributed to this now-
            // disconnected company), and stop the extension from silently
            // re-capturing the session the operator just cut.
            $this->proxies->release($tenant);
            $tenant->forceFill(['uber_org_uuid' => null])->save();
            $tenant->blockAutolink();

            return $deleted;
        });

        // Children first (device tokens + metrics reference a driver), then the
        // parents. Global scope bypassed so an admin without tenant context still
        // hits the rows.
        $counts = [
            'device_tokens' => $this->deleteForTenant(DeviceToken::class, $id),
            'driver_metrics' => $this->deleteForTenant(DriverMetric::class, $id),
            'offers' => $this->deleteForTenant(DispatchOffer::class, $id),
            'vehicles' => $this->deleteForTenant(Vehicle::class, $id),
            'drivers' => $this->deleteForTenant(Driver::class, $id),
            'sessions' => $sessions,
        ];

        $this->audit->log('fleet_session.purge', $tenant, ['counts' => $counts], $id);

        return $counts;
    }

    /** @param class-string<Model> $model */
    private function deleteForTenant(string $model, int $tenantId): int
    {
        return BatchDelete::run(
            fn () => $model::withoutGlobalScopes()->where('tenant_id', $tenantId),
            self::BATCH,
        );
    }
}
