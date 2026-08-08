<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DispatchOfferController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $offers = DispatchOffer::query()
            ->with('driver:id,name')
            // Filter by the driver's Uber UUID (exact) when provided.
            ->when($request->filled('driver_uuid'), fn ($q) => $q->where('driver_uuid', $request->string('driver_uuid')))
            // Free-text search across rider, driver name and both addresses.
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(function ($sub) use ($term) {
                    $sub->where('rider_first_name', 'like', $term)
                        ->orWhere('driver_first_name', 'like', $term)
                        ->orWhere('driver_last_name', 'like', $term)
                        ->orWhere('pickup_address', 'like', $term)
                        ->orWhere('dropoff_address', 'like', $term);
                });
            })
            ->orderByDesc('received_at')
            ->paginate(30)
            ->withQueryString();

        return DispatchOfferResource::collection($offers);
    }

    /** Delete a single offer. */
    public function destroy(DispatchOffer $offer): JsonResponse
    {
        $offer->delete();

        return response()->json(['data' => ['deleted' => 1]]);
    }

    /** Delete a selection of offers in one request. */
    public function bulkDestroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer'],
        ]);

        $deleted = DispatchOffer::whereIn('id', $data['ids'])->delete();

        return response()->json(['data' => ['deleted' => $deleted]]);
    }
}
