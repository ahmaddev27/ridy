<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
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
    public function sessions(): JsonResponse
    {
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->with('tenant:id,proxy_url')
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->get()
            ->filter->isUsable()
            ->map(fn (UberFleetSession $s) => [
                'id' => $s->id,
                'tenant_id' => $s->tenant_id,
                'uber_org_uuid' => $s->uber_org_uuid,
                'cookies' => $s->cookies,
                // Per-company residential proxy; daemon falls back to its global
                // UBER_PROXY_URL when null.
                'proxy_url' => $s->tenant?->getAttribute('proxy_url'),
            ])
            ->values();

        return response()->json(['data' => $sessions]);
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
    public function roster(Request $request, int $session, RosterSyncService $roster): JsonResponse
    {
        $data = $request->validate(['drivers' => ['required', 'array']]);

        $tenantId = (int) $this->find($session)->tenant_id;
        $result = $roster->sync($tenantId, $data['drivers']);

        return response()->json(['data' => $result]);
    }

    private function find(int $id): UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()->findOrFail($id);
    }
}
