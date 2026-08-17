<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\CompanyDataPurger;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Resources\Admin\CompanySessionResource;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin view + controls over a company's Uber fleet session. Cookies are
 * never exposed (CompanySessionResource whitelists fields).
 */
class CompanySessionController extends Controller
{
    public function show(Tenant $tenant): JsonResponse
    {
        $session = $this->sessionFor($tenant);

        return response()->json([
            'data' => $session ? new CompanySessionResource($session) : null,
        ]);
    }

    /** Force the company to re-link (marks the session needs_relink). */
    public function forceRelink(Tenant $tenant, FleetSessionService $service): JsonResponse
    {
        $session = $this->sessionFor($tenant);
        abort_if($session === null, 404, 'No session.');

        $service->markNeedsRelink($session);

        return response()->json(['data' => ['status' => UberFleetSession::STATUS_NEEDS_RELINK]]);
    }

    /** Delete the session entirely (company must re-link from scratch). */
    public function destroy(Tenant $tenant): JsonResponse
    {
        $deleted = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();

        return response()->json(['data' => ['deleted' => $deleted]]);
    }

    /**
     * Disconnect AND wipe: delete the session plus all of the company's
     * operational fleet data (drivers, vehicles, offers, device tokens,
     * metrics). Keeps the tenant, its users and billing history. Returns the
     * per-entity delete counts for the confirmation toast.
     */
    public function purge(Tenant $tenant, CompanyDataPurger $purger): JsonResponse
    {
        return response()->json(['data' => $purger->purge($tenant)]);
    }

    private function sessionFor(Tenant $tenant): ?UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('updated_at')
            ->first();
    }
}
