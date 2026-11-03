<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Collection;

/**
 * Finds the session + residential proxy a Fleet Hub pull for one company runs
 * on, and (for the scheduled syncs) which companies have both.
 *
 * Every lookup carries the tenant as a term, so no input can name another
 * fleet's session. Selection mirrors DispatchDaemonController::sessions: an
 * active, usable session of a company whose subscription has not lapsed.
 */
class FleetHubSessionResolver
{
    /**
     * @return array{0: UberFleetSession, 1: string} the session and its proxy URL
     *
     * @throws UberEarningsException
     */
    public function forTenant(Tenant $tenant): array
    {
        $session = UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->whereNotNull('uber_org_uuid')
            ->latest('id')
            ->first();
        if ($session === null || ! $session->isUsable() || empty($session->supplier_cookies)) {
            throw new UberEarningsException('no_uber_session', 'No usable Uber session is connected.', 409);
        }

        $proxy = $tenant->proxy_url;
        if (! is_string($proxy) || $proxy === '') {
            // No datacenter fallback: Uber blocks those addresses.
            throw new UberEarningsException('no_proxy', 'This company has no residential proxy assigned.', 409);
        }

        return [$session, $proxy];
    }

    /**
     * Companies a scheduled sync may pull for: usable session with a supplier
     * jar, a proxy, and a subscription that has not lapsed.
     *
     * @return Collection<int, Tenant>
     */
    public function eligibleTenants(): Collection
    {
        // Optional allowlist for a gradual rollout: validate the server-side sync on one
        // company before letting it run fleet-wide (empty = every eligible company).
        $allow = (array) config('services.uber.server_sync_tenants', []);

        return UberFleetSession::withoutGlobalScopes()
            ->with('tenant')
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->whereNotNull('uber_org_uuid')
            ->latest('id')
            ->get()
            ->unique('tenant_id')
            ->filter(fn (UberFleetSession $s) => $s->isUsable()
                && ! empty($s->supplier_cookies)
                && $s->tenant !== null
                && $s->tenant->onNewSystem()
                && $s->tenant->stateReason() === null
                && is_string($s->tenant->proxy_url)
                && $s->tenant->proxy_url !== ''
                && ($allow === [] || in_array((string) $s->tenant_id, $allow, true)))
            ->map(fn (UberFleetSession $s) => $s->tenant)
            ->values();
    }
}
