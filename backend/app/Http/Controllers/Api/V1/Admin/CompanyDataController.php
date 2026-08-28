<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Http\Resources\DriverResource;
use Illuminate\Http\JsonResponse;
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
     * The raw dispatch "network" feed: every offer this company received from the
     * supplier (Uber), with the exact captured payload, so the super-admin can
     * inspect precisely what came over the wire — both addresses, fare, waypoints,
     * multi-stop, etc. Read-only, newest first, paginated.
     */
    public function network(Tenant $tenant): JsonResponse
    {
        $offers = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->with('driver:id,name')
            ->latest('received_at')
            ->paginate(30);

        return response()->json([
            'data' => collect($offers->items())->map(fn (DispatchOffer $o) => [
                'id' => $o->id,
                'offer_uuid' => $o->offer_uuid,
                'received_at' => $o->received_at,
                'driver' => $o->driver?->name,
                'driver_uuid' => $o->driver_uuid,
                'pickup_address' => $o->pickup_address,
                'dropoff_address' => $o->dropoff_address,
                'fare_amount' => $o->fare_amount !== null ? (float) $o->fare_amount : null,
                'distance_m' => $o->distance_m,
                'status' => $o->status,
                // The exact supplier payload as captured — the "network request".
                'raw_payload' => $o->raw_payload,
            ]),
            'meta' => ['current_page' => $offers->currentPage(), 'last_page' => $offers->lastPage(), 'total' => $offers->total()],
        ]);
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
