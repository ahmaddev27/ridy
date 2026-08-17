<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\CompanyDataPurger;
use App\Domain\Tenancy\ProxyPool;
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
     * Disconnect = full wipe: delete the tenant's Uber session AND all of its
     * fleet data (drivers, vehicles, offers, devices, metrics), free its proxy
     * slot, and block the extension's silent auto-relink until the manager
     * explicitly reconnects. The daemon stops the streams on its next reconcile.
     */
    public function destroy(CompanyDataPurger $purger): JsonResponse
    {
        $tenant = request()->user()->tenant;

        return response()->json(['data' => $purger->purge($tenant)]);
    }

    /**
     * The manager pastes their captured Uber session (cookies + getUser org id).
     * We store it encrypted and bind the tenant to its Uber org.
     */
    public function capture(CaptureFleetSessionRequest $request, FleetSessionService $service, ProxyPool $proxies): JsonResponse
    {
        $tenant = $request->user()->tenant;
        $manual = $request->boolean('manual');

        // After an operator disconnects, the extension keeps auto-capturing on
        // every Uber page load. Refuse those silent (non-manual) captures until
        // the manager explicitly reconnects, so a wiped company stays wiped.
        if (! $manual && $tenant->isAutolinkBlocked()) {
            return response()->json(['data' => ['status' => 'blocked', 'reason' => 'autolink_blocked']], 202);
        }

        // An explicit reconnect clears the block and re-acquires a proxy slot
        // (the wipe released it).
        if ($manual) {
            $tenant->unblockAutolink();
            if ($tenant->proxy_id === null) {
                $proxies->assign($tenant);
            }
        }

        $cookies = $request->array('cookies');

        // Audit trail only — never log cookie values (they are session secrets).
        RidyLog::event('fleet_session.captured', [
            'tenant_id' => $tenant->id,
            'uber_org_uuid' => (string) $request->string('uber_org_uuid'),
            'cookie_count' => count($cookies),
        ]);

        $session = $service->capture(
            $tenant,
            (string) $request->string('uber_org_uuid'),
            $cookies,
            $request->filled('expires_at') ? CarbonImmutable::parse($request->string('expires_at')) : null,
            $request->filled('uber_org_name') ? (string) $request->string('uber_org_name') : null,
            $request->filled('supplier_cookies') ? $request->array('supplier_cookies') : null,
        );

        return response()->json(['data' => $session->only([
            'uber_org_uuid', 'status', 'expires_at',
        ])], 201);
    }
}
