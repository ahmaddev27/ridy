<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The driver app's own offer history — scoped to the authenticated driver only,
 * regardless of tenant context. Supports search, status, and date filters with
 * pagination for the offers list.
 */
class DriverOfferController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $offers = $this->filtered($request)
            ->orderByDesc('received_at')
            ->paginate(min(50, max(5, (int) $request->integer('per_page', 20))))
            ->withQueryString();

        return DispatchOfferResource::collection($offers);
    }

    /** The driver's offers with the list's filters (search / status / date range) applied. */
    private function filtered(Request $request): Builder
    {
        return DispatchOffer::withoutGlobalScopes()
            ->where('driver_id', $request->user()->id)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('received_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('received_at', '<=', $request->date('to')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(fn ($sub) => $sub
                    ->where('rider_first_name', 'like', $term)
                    ->orWhere('pickup_address', 'like', $term)
                    ->orWhere('dropoff_address', 'like', $term));
            });
    }
}
