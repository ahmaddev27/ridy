<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

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
     * jar, a proxy, and a subscription that has not lapsed. Every company that
     * has an active session but is skipped is logged with the reason.
     *
     * @return Collection<int, Tenant>
     */
    public function eligibleTenants(): Collection
    {
        return UberFleetSession::withoutGlobalScopes()
            ->with('tenant')
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->whereNotNull('uber_org_uuid')
            ->latest('id')
            ->get()
            ->unique('tenant_id')
            ->filter(fn (UberFleetSession $s) => $this->logSkip($s) === null)
            ->map(fn (UberFleetSession $s) => $s->tenant)
            ->values();
    }

    /**
     * The company's Tenant when it passes the same test as the scheduled sync,
     * otherwise null (reason logged) — for on-connect and on-demand syncs.
     */
    public function eligibleTenant(Tenant $tenant): ?Tenant
    {
        $session = $this->activeSession($tenant);
        if ($session === null) {
            Log::info('fleethub.sync_skipped', ['tenant' => $tenant->id, 'reason' => 'no_active_session']);

            return null;
        }

        return $this->logSkip($session) === null ? $session->tenant : null;
    }

    /** Why this company is not synced, or null when it is. Never contains secrets. */
    public function skipReasonFor(Tenant $tenant): ?string
    {
        $session = $this->activeSession($tenant);

        return $session === null ? 'no_active_session' : $this->skipReason($session);
    }

    public function skipReason(UberFleetSession $s): ?string
    {
        // Optional allowlist for a gradual rollout (empty = every eligible company).
        $allow = (array) config('services.uber.server_sync_tenants', []);
        $tenant = $s->tenant;

        return match (true) {
            $tenant === null => 'no_tenant',
            ! $s->isUsable() => 'session_not_usable',
            empty($s->supplier_cookies) => 'no_supplier_jar',
            ! $tenant->onNewSystem() => 'not_on_new_system',
            $tenant->stateReason() !== null => 'subscription_lapsed',
            ! is_string($tenant->proxy_url) || $tenant->proxy_url === '' => 'no_proxy',
            $allow !== [] && ! in_array((string) $s->tenant_id, $allow, true) => 'not_in_allowlist',
            default => null,
        };
    }

    private function activeSession(Tenant $tenant): ?UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()
            ->with('tenant')
            ->where('tenant_id', $tenant->id)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->whereNotNull('uber_org_uuid')
            ->latest('id')
            ->first();
    }

    private function logSkip(UberFleetSession $s): ?string
    {
        $reason = $this->skipReason($s);
        if ($reason !== null) {
            Log::info('fleethub.sync_skipped', ['tenant' => $s->tenant_id, 'reason' => $reason]);
        }

        return $reason;
    }
}
