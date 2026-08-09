<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DispatchOfferIngestor;
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

    /**
     * The Ridy extension holds the RAMEN stream in the manager's own browser
     * (real IP, so Uber responds — our datacenter IP is blocked) and posts the
     * offers it sees here. Ingestion is idempotent on offer_uuid, so the same
     * offer arriving from the stream more than once is de-duplicated.
     */
    public function ingest(Request $request, DispatchOfferIngestor $ingestor): JsonResponse
    {
        $data = $request->validate([
            'offers' => ['required', 'array'],
            'offers.*' => ['array'],
            'seq' => ['nullable', 'integer'],
        ]);

        $tenantId = (int) $request->user()->tenant_id;
        $results = ['routed' => 0, 'unlinked_driver' => 0, 'duplicate' => 0, 'skipped_no_uuid' => 0];

        foreach ($data['offers'] as $offer) {
            $outcome = $ingestor->ingest($tenantId, $offer, $data['seq'] ?? null);
            $results[$outcome['status']] = ($results[$outcome['status']] ?? 0) + 1;
        }

        return response()->json(['data' => $results]);
    }

    /** Full detail for one offer, including the complete raw Uber payload. */
    public function show(Request $request, DispatchOffer $offer): JsonResponse
    {
        return response()->json([
            'data' => array_merge(
                (new DispatchOfferResource($offer))->toArray($request),
                ['raw' => $offer->raw_payload],
            ),
        ]);
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
