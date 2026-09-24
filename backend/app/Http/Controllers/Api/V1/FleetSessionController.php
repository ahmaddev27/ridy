<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\CompanyDataPurger;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\ProxyPool;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\CaptureFleetSessionRequest;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FleetSessionController extends Controller
{
    /**
     * How recently the daemon must have delivered a frame for us to treat its
     * offer stream as alive (mirrors SystemHealthService's heartbeat TTL).
     */
    private const DAEMON_LIVE_MINUTES = 5;

    public function __construct(private readonly AuditLogger $audit) {}

    /** Current fleet session status for the manager's tenant (no cookies exposed). */
    public function show(): JsonResponse
    {
        $session = $this->tenantSessions($this->tenantOrFail())->orderByDesc('updated_at')->first();

        return response()->json(['data' => $session?->only([
            'uber_org_uuid', 'status', 'expires_at', 'last_event_at',
        ])]);
    }

    /**
     * Disconnect = full wipe: delete the tenant's Uber session AND all of its
     * fleet data (drivers, vehicles, offers, devices, metrics), free its proxy
     * slot, and block the extension's silent auto-relink until the manager
     * explicitly reconnects. The daemon stops the streams on its next reconcile.
     */
    public function destroy(CompanyDataPurger $purger): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $orgUuid = $tenant->uber_org_uuid; // read before the purge clears it

        $result = $purger->purge($tenant);

        // Who wiped the fleet, and through which credential (dashboard session or
        // the extension token) — the purge doesn't touch audit_logs.
        $this->audit->log('fleet_session.purged', null, [
            'uber_org_uuid' => $orgUuid,
            'counts' => $result,
            'token_name' => $this->tokenName(),
        ]);

        return response()->json(['data' => $result]);
    }

    /**
     * The manager pressed "Connect" on the dashboard. Clear the autolink block
     * server-side so the very next capture succeeds — this works regardless of
     * the installed extension version (an older extension can't send the
     * `manual` flag, so without this an autolink-blocked tenant could never
     * reconnect and the connect button would spin forever).
     */
    public function reconnect(): JsonResponse
    {
        $this->tenantOrFail()->unblockAutolink();
        $this->audit->log('fleet_session.reconnect_requested', null, ['token_name' => $this->tokenName()]);

        return response()->json(['data' => ['status' => 'ready']]);
    }

    /**
     * The paired extension observed Uber reject THIS manager's session (a 401/403
     * from supplier.uber.com — typically after the company changed its Uber
     * password). Flag it needs_relink so the manager is alerted and prompted to
     * reconnect. This is the detector for datacenter-IP deploys where the daemon's
     * RAMEN stream is 404-blocked and never reaches the supplier polls itself.
     * Idempotent: markNeedsRelink only notifies on the active→broken transition.
     */
    public function reportBroken(FleetSessionService $service): JsonResponse
    {
        $session = $this->tenantSessions($this->tenantOrFail())->orderByDesc('updated_at')->first();

        if ($session !== null && $session->status === UberFleetSession::STATUS_ACTIVE) {
            // If the server-side daemon is actively streaming this session (a fresh
            // last_event_at), the RAMEN offer stream is provably alive — the 401/403
            // the manager's browser hit is only THEIR Fleet Hub session, not ours.
            // Flagging the session broken here would tear down a working offer stream
            // (the 2026-09-13 outage: the manager's browser knocked out live offers).
            // Treat it as supplier-degraded instead: prompt a reconnect, keep streaming.
            $streaming = $session->last_event_at !== null
                && $session->last_event_at->greaterThanOrEqualTo(now()->subMinutes(self::DAEMON_LIVE_MINUTES));

            if ($streaming) {
                $service->notifySupplierDegraded($session, 'extension');
            } else {
                $service->markNeedsRelink($session, 'extension');
            }

            $this->audit->log('fleet_session.reported_broken', $session, ['streaming' => $streaming]);
        }

        return response()->json(['data' => ['status' => $session?->status ?? 'none']]);
    }

    /**
     * The manager pastes their captured Uber session (cookies + getUser org id).
     * We store it encrypted and bind the tenant to its Uber org.
     */
    public function capture(CaptureFleetSessionRequest $request, FleetSessionService $service, ProxyPool $proxies): JsonResponse
    {
        $tenant = $this->tenantOrFail();
        $manual = $request->boolean('manual');
        $orgUuid = (string) $request->string('uber_org_uuid');

        // One Uber account = one company. If another tenant holds a PROVEN (or
        // freshly active) session for this org, refuse: two streams on the same
        // account duplicate offers/drivers, burn two proxies, and get the Uber
        // account flagged for concurrent logins. An unproven claim that broke or
        // went quiet (e.g. junk cookies posted with someone else's org id) no
        // longer blocks the real owner forever — it is released below.
        $claims = UberFleetSession::withoutGlobalScopes()
            ->where('uber_org_uuid', $orgUuid)
            ->where('tenant_id', '!=', $tenant->id)
            ->get();
        if ($claims->contains(fn (UberFleetSession $s) => $s->holdsOrgClaim())) {
            // Evidence for an org dispute — only for a deliberate Connect, not the
            // extension's silent auto-capture on every page load.
            if ($manual) {
                $this->audit->log('fleet_session.org_conflict', null, [
                    'uber_org_uuid' => $orgUuid,
                    'held_by_tenant_ids' => $claims->pluck('tenant_id')->all(),
                ]);
            }

            return response()->json([
                'message' => 'uber_org_already_linked',
                'reason' => 'This Uber account is already linked to another company.',
            ], 409);
        }

        // After an operator disconnects, the extension keeps auto-capturing on
        // every Uber page load. Refuse those silent (non-manual) captures until
        // the manager explicitly reconnects, so a wiped company stays wiped.
        if (! $manual && $tenant->isAutolinkBlocked()) {
            return response()->json(['data' => ['status' => 'blocked', 'reason' => 'autolink_blocked']], 202);
        }

        // One company = one Uber org. A silent auto-capture from a DIFFERENT org
        // (the manager's browser opened another fleet) must not add a second
        // session; switching orgs takes an explicit Connect. 202, like the autolink
        // block, so the extension doesn't retry on every page load.
        $hasOtherOrg = UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('uber_org_uuid', '!=', $orgUuid)
            ->exists();
        if ($hasOtherOrg && ! $manual) {
            return response()->json(['data' => ['status' => 'blocked', 'reason' => 'org_change_requires_connect']], 202);
        }

        // An explicit reconnect clears the block and re-acquires a proxy slot
        // (the wipe released it).
        if ($manual) {
            $tenant->unblockAutolink();
            if ($tenant->proxy_id === null) {
                $proxies->assign($tenant);
            }
        }

        if ($claims->isNotEmpty()) {
            $this->releaseStaleClaims($claims, $tenant, $orgUuid);
        }

        $cookies = $request->array('cookies');
        $session = $service->capture(
            $tenant,
            $orgUuid,
            $cookies,
            $request->filled('expires_at') ? CarbonImmutable::parse($request->string('expires_at')) : null,
            $request->filled('uber_org_name') ? (string) $request->string('uber_org_name') : null,
            $request->filled('supplier_cookies') ? $request->array('supplier_cookies') : null,
            replaceOtherOrgs: $hasOtherOrg && $manual,
        );

        // Never log cookie values (they are session secrets).
        $this->audit->log('fleet_session.captured', $session, [
            'uber_org_uuid' => $orgUuid,
            'manual' => $manual,
            'cookie_count' => count($cookies),
            'had_supplier_cookies' => $request->filled('supplier_cookies'),
            'replaced_other_org' => $hasOtherOrg && $manual,
            'token_name' => $this->tokenName(),
        ]);

        return response()->json(['data' => $session->only([
            'uber_org_uuid', 'status', 'expires_at',
        ])], 201);
    }

    /**
     * Drop another company's unproven, stale claim on this org so the real owner
     * can connect (uber_org_uuid is globally unique). Recorded, and logged for ops.
     *
     * @param  Collection<int, UberFleetSession>  $claims
     */
    private function releaseStaleClaims($claims, Tenant $tenant, string $orgUuid): void
    {
        DB::transaction(function () use ($claims, $orgUuid) {
            foreach ($claims as $claim) {
                $claim->delete();
                Tenant::whereKey($claim->tenant_id)->where('uber_org_uuid', $orgUuid)->update(['uber_org_uuid' => null]);
            }
        });

        $context = ['uber_org_uuid' => $orgUuid, 'new_tenant_id' => $tenant->id, 'released_tenant_ids' => $claims->pluck('tenant_id')->all()];
        Log::warning('fleet_session.org_takeover', $context);
        $this->audit->log('fleet_session.org_takeover', null, $context);
    }

    /**
     * The caller's company. A super-admin who isn't impersonating has none: a
     * clean 403 instead of a 500 (and never another company's session).
     */
    private function tenantOrFail(): Tenant
    {
        $tenant = request()->user()?->tenant;
        abort_if($tenant === null, 403, 'no_tenant');

        return $tenant;
    }

    /** @return Builder<UberFleetSession> */
    private function tenantSessions(Tenant $tenant)
    {
        return UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id);
    }

    /** Which credential acted: the dashboard session (null) or a named token. */
    private function tokenName(): ?string
    {
        $token = request()->user()?->currentAccessToken();

        return is_object($token) && isset($token->name) ? (string) $token->name : null;
    }
}
