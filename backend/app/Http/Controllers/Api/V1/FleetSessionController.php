<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\CaptureFleetSessionRequest;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;

class FleetSessionController extends Controller
{
    /** Current fleet session status for the manager's tenant (no cookies exposed). */
    public function show(): JsonResponse
    {
        $session = UberFleetSession::query()->orderByDesc('updated_at')->first();

        return response()->json(['data' => $session?->only([
            'uber_org_uuid', 'status', 'expires_at', 'last_event_at',
        ])]);
    }

    /**
     * Disconnect: delete the tenant's Uber fleet session(s). The daemon stops
     * their streams on its next reconcile. Used to clear a stale session before
     * re-linking with fresh cookies.
     */
    public function destroy(): JsonResponse
    {
        // Auto-scoped to the manager's tenant by the BelongsToTenant global scope.
        $deleted = UberFleetSession::query()->delete();

        return response()->json(['data' => ['deleted' => $deleted]]);
    }

    /**
     * The manager pastes their captured Uber session (cookies + getUser org id).
     * We store it encrypted and bind the tenant to its Uber org.
     */
    public function capture(CaptureFleetSessionRequest $request, FleetSessionService $service): JsonResponse
    {
        $tenant = $request->user()->tenant;
        $cookies = $request->array('cookies');

        // Test aid: full captured session as readable JSON in storage/logs/ridy.log.
        RidyLog::event('fleet_session.captured', [
            'tenant_id' => $tenant->id,
            'uber_org_uuid' => (string) $request->string('uber_org_uuid'),
            'cookie_count' => count($cookies),
            'cookie_names' => array_map(fn ($c) => $c['name'] ?? '?', $cookies),
            'cookies' => $cookies,
        ]);

        $session = $service->capture(
            $tenant,
            (string) $request->string('uber_org_uuid'),
            $cookies,
            $request->filled('expires_at') ? CarbonImmutable::parse($request->string('expires_at')) : null,
        );

        return response()->json(['data' => $session->only([
            'uber_org_uuid', 'status', 'expires_at',
        ])], 201);
    }
}
