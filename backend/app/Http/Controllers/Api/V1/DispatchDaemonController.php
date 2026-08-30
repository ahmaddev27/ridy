<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\ShardService;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Http\Controllers\Controller;
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
    public function refreshCookies(Request $request, int $session): JsonResponse
    {
        $data = $request->validate([
            'cookies' => ['required', 'array', 'min:1'],
            'cookies.*.name' => ['required', 'string'],
            'cookies.*.value' => ['required', 'string'],
            'expires_at' => ['nullable', 'date'],
        ]);

        $model = $this->find($session);
        $model->forceFill([
            'cookies' => $data['cookies'],
            'expires_at' => isset($data['expires_at']) ? CarbonImmutable::parse($data['expires_at']) : $model->expires_at,
            'last_event_at' => CarbonImmutable::now(),
        ])->save();

        return response()->json(['data' => ['status' => 'refreshed']]);
    }

    /**
     * The daemon polls supplier GetDriverLiveLocation continuously and forwards
     * the statuses here. Same effect as the manager's extension sync (updates
     * presence + marks offers accepted on an ON_TRIP transition) but runs 24/7.
     */
    public function statuses(Request $request, int $session, DriverStatusIngestor $ingestor, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'statuses' => ['required', 'array'],
            'statuses.*.driver_uuid' => ['required', 'string'],
            'statuses.*.status' => ['nullable', 'string'],
            'statuses.*.location_updated_at' => ['nullable', 'numeric'],
            'statuses.*.latitude' => ['nullable', 'numeric'],
            'statuses.*.longitude' => ['nullable', 'numeric'],
            'statuses.*.heading' => ['nullable', 'numeric'],
            'statuses.*.waypoints' => ['nullable', 'array'],
        ]);

        $tenantId = (int) $this->find($session)->tenant_id;
        $recorder->statuses($tenantId, $data['statuses']);
        $result = $ingestor->ingest($tenantId, $data['statuses']);

        return response()->json(['data' => $result]);
    }

    /** The daemon saw Uber reject the session; flag it for manager re-link. */
    public function needsRelink(int $session, FleetSessionService $service): JsonResponse
    {
        $service->markNeedsRelink($this->find($session));

        return response()->json(['data' => ['status' => UberFleetSession::STATUS_NEEDS_RELINK]]);
    }

    /** Liveness heartbeat — records that the stream is still delivering. */
    public function heartbeat(int $session): JsonResponse
    {
        $this->find($session)->forceFill(['last_event_at' => CarbonImmutable::now()])->save();

        return response()->json(['data' => ['status' => 'ok']]);
    }

    /**
     * The daemon fetched supplier /api/getDrivers for a session's org and forwards
     * the driver list here to be upserted into the roster.
     */
    public function roster(Request $request, int $session, RosterSyncService $roster, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate(['drivers' => ['required', 'array']]);

        $tenantId = (int) $this->find($session)->tenant_id;
        $recorder->roster($tenantId, $data['drivers']);
        $result = $roster->sync($tenantId, $data['drivers']);

        return response()->json(['data' => $result]);
    }

    private function find(int $id): UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()->findOrFail($id);
    }
}
