<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\ShardService;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IngestDriverStatusesRequest;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Internal API the Node dispatch daemon polls. Authenticated by the shared
 * dispatch secret (same guard as ingest), never a user session. The daemon has
 * no tenant context, so sessions are resolved without the tenant global scope.
 */
class DispatchDaemonController extends Controller
{
    /**
     * Every usable fleet session with its cookies, so the daemon can open a
     * RAMEN stream per fleet. Cookies are decrypted here — this endpoint is
     * secret-guarded and internal-only.
     */
    public function sessions(Request $request, ShardService $shards): JsonResponse
    {
        // Each daemon box identifies itself by shard name (default "main" for a
        // single-box deploy). Heartbeat it, then (re)assign unowned or stranded
        // companies to a live shard — so adding a box auto-picks-up new companies
        // and a dead box's companies fail over to survivors.
        $shard = $shards->heartbeat((string) ($request->header('X-Shard-Id') ?: 'main'));
        $shards->reconcileAssignments();

        $sessions = UberFleetSession::withoutGlobalScopes()
            ->with('tenant:id,proxy_url,status,banned_at,activated_at,subscription_ends_at')
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->where('shard_id', $shard->id) // only the companies this box owns
            ->get()
            // Never stream a company whose subscription has lapsed (expired /
            // disabled / banned): keeping its RAMEN stream open would burn a proxy
            // and process offers for a tenant that no longer pays. A resubscribe
            // clears stateReason() and the stream resumes on the next poll.
            ->filter(fn (UberFleetSession $s) => $s->isUsable()
                && $s->tenant !== null
                && $s->tenant->stateReason() === null)
            ->map(fn (UberFleetSession $s) => [
                'id' => $s->id,
                'tenant_id' => $s->tenant_id,
                'uber_org_uuid' => $s->uber_org_uuid,
                'cookies' => $s->cookies,
                // supplier.uber.com-scoped jar for roster/status polls (RAMEN uses
                // `cookies`). Null for sessions captured before this was added.
                'supplier_cookies' => $s->supplier_cookies,
                // Per-company residential proxy; daemon falls back to its global
                // UBER_PROXY_URL when null.
                'proxy_url' => $s->tenant?->getAttribute('proxy_url'),
                // The cookie-jar generation this stream runs on. The daemon echoes it
                // on cookie/relink/degraded reports so a stale stream's write is
                // refused once a reconnect stored a newer jar (see staleJar()).
                'jar_version' => (int) $s->jar_version,
            ])
            ->values();

        // Proxies are assigned per-company from the shared pool (see ProxyPool);
        // there is no global fallback proxy any more.
        return response()->json([
            'data' => $sessions,
            'meta' => ['global_proxy_url' => null],
        ]);
    }

    /**
     * Persist cookies the daemon captured from Set-Cookie while holding the
     * stream. This rolling refresh keeps an actively-used session alive well
     * beyond its idle lifetime — no password required.
     */
    public function refreshCookies(Request $request, int $session, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'cookies' => ['required', 'array', 'min:1', 'max:200'],
            'cookies.*.name' => ['required', 'string'],
            'cookies.*.value' => ['required', 'string'],
            'expires_at' => ['nullable', 'date'],
            'jar_version' => ['nullable', 'integer'],
        ]);

        $model = $this->find($request, $session);
        $version = $this->jarVersion($request);
        if ($this->staleJar($model, $version)) {
            return $this->staleJarResponse();
        }

        $model->forceFill([
            'cookies' => $data['cookies'],
            'expires_at' => isset($data['expires_at']) ? CarbonImmutable::parse($data['expires_at']) : $model->expires_at,
            'last_event_at' => CarbonImmutable::now(),
        ]);

        // Check-and-write atomically: a reconnect landing between the check above
        // and this write must still win.
        $written = UberFleetSession::withoutGlobalScopes()
            ->whereKey($model->getKey())
            ->when($version !== null, fn ($q) => $q->where('jar_version', $version))
            ->update($model->getDirty());
        if ($written !== 1) {
            return $this->staleJarResponse();
        }

        // Log the event WITHOUT the cookie values (secrets) — count + expiry only.
        $recorder->session((int) $model->tenant_id, 'cookies_refreshed', [
            'cookie_count' => count($data['cookies']),
            'expires_at' => $data['expires_at'] ?? null,
        ]);

        return response()->json(['data' => ['status' => 'refreshed']]);
    }

    /**
     * The daemon polls supplier GetDriverLiveLocation continuously and forwards
     * the statuses here. Same effect as the manager's extension sync (updates
     * presence + marks offers accepted on an ON_TRIP transition) but runs 24/7.
     */
    public function statuses(IngestDriverStatusesRequest $request, int $session, DriverStatusIngestor $ingestor, SupplierNetworkRecorder $recorder, FleetSessionService $sessions): JsonResponse
    {
        $data = $request->validated();

        $model = $this->find($request, $session);
        $tenantId = (int) $model->tenant_id;
        // A Fleet Hub live-status read for this org succeeded with the stored
        // cookies: the company's claim on the org is proven.
        $sessions->markVerified($model);
        // Mark the daemon as this company's status source first, so a concurrent
        // (older) extension batch stands down — see DriverController::ingestStatuses.
        DriverStatusIngestor::markDaemonFeeding($tenantId);
        $recorder->statuses($tenantId, $data['statuses']);
        $result = $ingestor->ingest($tenantId, $data['statuses']);

        return response()->json(['data' => $result]);
    }

    /** The daemon saw Uber reject the session; flag it for manager re-link. */
    public function needsRelink(Request $request, int $session, FleetSessionService $service): JsonResponse
    {
        $model = $this->find($request, $session);
        // A 401 on the jar a reconnect just REPLACED says nothing about the fresh
        // one — flagging it would stop offers right after a successful Connect.
        if ($this->staleJar($model, $this->jarVersion($request))) {
            return $this->staleJarResponse();
        }

        // markNeedsRelink records the 'needs_relink' event (tagged source=daemon).
        $service->markNeedsRelink($model, 'daemon');

        return response()->json(['data' => ['status' => UberFleetSession::STATUS_NEEDS_RELINK]]);
    }

    /**
     * The daemon's Fleet Hub polls (roster/live-status) are being rejected, but its
     * RAMEN offer stream is still alive. Prompt the manager to reconnect WITHOUT
     * flagging the session broken — flagging it would drop the still-working offer
     * stream. See FleetSessionService::notifySupplierDegraded.
     */
    public function supplierDegraded(Request $request, int $session, FleetSessionService $service): JsonResponse
    {
        $model = $this->find($request, $session);
        if ($this->staleJar($model, $this->jarVersion($request))) {
            return $this->staleJarResponse();
        }

        $service->notifySupplierDegraded($model, 'daemon');

        return response()->json(['data' => ['status' => 'degraded']]);
    }

    /** Liveness heartbeat — records that the stream is still delivering. */
    public function heartbeat(Request $request, int $session): JsonResponse
    {
        $this->find($request, $session)->forceFill(['last_event_at' => CarbonImmutable::now()])->save();

        return response()->json(['data' => ['status' => 'ok']]);
    }

    /**
     * The daemon fetched supplier /api/getDrivers for a session's org and forwards
     * the driver list here to be upserted into the roster.
     */
    public function roster(Request $request, int $session, RosterSyncService $roster, SupplierNetworkRecorder $recorder, FleetSessionService $sessions): JsonResponse
    {
        $data = $request->validate([
            'drivers' => ['required', 'array', 'max:'.RosterSyncService::MAX_DRIVERS],
            'drivers.*' => ['array'],
        ]);

        $model = $this->find($request, $session);
        $tenantId = (int) $model->tenant_id;
        $sessions->markVerified($model);

        // A session left on an org the company has since switched away from must
        // not sync: its roster would mark the current org's drivers as removed.
        $tenantOrg = Tenant::whereKey($tenantId)->value('uber_org_uuid');
        if ($tenantOrg !== null && $tenantOrg !== $model->uber_org_uuid) {
            return response()->json(['data' => ['synced' => 0, 'created' => 0, 'removed' => 0, 'skipped' => 'stale_org']]);
        }

        $recorder->roster($tenantId, $data['drivers']);
        $result = $roster->sync($tenantId, $data['drivers']);

        return response()->json(['data' => $result]);
    }

    /**
     * The session, refused (409) when the calling daemon box is not the shard
     * that owns it — a box that lost the company in a rebalance/failover must not
     * keep writing to it. Callers without a shard header (single-box legacy) and
     * unassigned sessions pass.
     */
    private function find(Request $request, int $id): UberFleetSession
    {
        $session = UberFleetSession::withoutGlobalScopes()->findOrFail($id);

        $shardName = (string) $request->header('X-Shard-Id', '');
        if ($shardName !== '' && $session->shard_id !== null) {
            $shardId = DaemonShard::where('name', $shardName)->value('id');
            if ($shardId !== null && (int) $shardId !== (int) $session->shard_id) {
                abort(response()->json(['message' => 'wrong_shard'], 409));
            }
        }

        return $session;
    }

    /** The jar version the daemon's stream runs on (body or header); null from older daemons. */
    private function jarVersion(Request $request): ?int
    {
        $version = $request->input('jar_version', $request->header('X-Jar-Version'));

        return is_numeric($version) ? (int) $version : null;
    }

    /**
     * Whether the report comes from a stream on an OLDER cookie jar than the one
     * stored (a reconnect replaced it). Reports without a version (daemons that
     * predate it) are accepted as before.
     */
    private function staleJar(UberFleetSession $session, ?int $version): bool
    {
        return $version !== null && $version !== (int) $session->jar_version;
    }

    private function staleJarResponse(): JsonResponse
    {
        return response()->json(['message' => 'stale_jar'], 409);
    }
}
