<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Http\Resources\DriverResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Read-only drill-down into one company's fleet data for the super-admin. Runs
 * cross-tenant (the admin group has no ResolveTenant), so every query drops the
 * tenant global scope and filters by the explicit tenant id.
 */
class CompanyDataController extends Controller
{
    public function drivers(Tenant $tenant): AnonymousResourceCollection
    {
        $drivers = Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderBy('name')
            ->get();

        return DriverResource::collection($drivers);
    }

    public function offers(Tenant $tenant): AnonymousResourceCollection
    {
        $offers = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->latest('received_at')
            ->paginate(50); // paginator -> the resource collection adds meta/links

        return DispatchOfferResource::collection($offers);
    }

    /**
     * The raw dispatch "network" feed: every inbound request this company received
     * from the supplier — offers, driver status/location syncs, roster pulls — with
     * the exact captured payload, so the super-admin can inspect precisely what came
     * over the wire. Read-only, newest first, paginated; filter by `kind`.
     */
    public function network(Request $request, Tenant $tenant): JsonResponse
    {
        $logs = DispatchNetworkLog::query()
            ->where('tenant_id', $tenant->id)
            ->when($request->filled('kind'), fn ($q) => $q->where('kind', $request->string('kind')))
            // Optional date-time range on capture time (ISO 8601 / any parseable form).
            ->when($request->filled('from'), fn ($q) => $q->where('created_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->where('created_at', '<=', $request->date('to')))
            ->latest('created_at')
            ->paginate(30);

        return response()->json([
            'data' => collect($logs->items())->map(fn (DispatchNetworkLog $log) => [
                'id' => $log->id,
                'kind' => $log->kind,
                'summary' => $log->summary,
                'count' => $log->count,
                'created_at' => $log->created_at,
                'raw_payload' => $log->payload,
            ]),
            'meta' => ['current_page' => $logs->currentPage(), 'last_page' => $logs->lastPage(), 'total' => $logs->total()],
        ]);
    }

    /** Purge every captured network log for a single company (scoped, irreversible). */
    public function clearNetwork(Tenant $tenant): JsonResponse
    {
        $deleted = DispatchNetworkLog::query()->where('tenant_id', $tenant->id)->delete();

        return response()->json(['data' => ['deleted' => $deleted]]);
    }

    public function vehicles(Tenant $tenant): JsonResponse
    {
        $vehicles = Vehicle::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderBy('license_plate')
            ->get()
            ->map(fn (Vehicle $v) => [
                'id' => $v->id,
                'make' => $v->make,
                'model' => $v->model,
                'year' => $v->year,
                'license_plate' => $v->license_plate,
                'color' => $v->color,
                'compliance_status' => $v->compliance_status,
            ]);

        return response()->json(['data' => $vehicles]);
    }
}
