<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Support\RidyLog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DispatchOfferController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $offers = $this->filtered($request)
            ->with('driver:id,name')
            ->orderByDesc('received_at')
            ->paginate(min(100, max(5, (int) $request->integer('per_page', 25))))
            ->withQueryString();

        return DispatchOfferResource::collection($offers);
    }

    /** Lightweight aggregates for the current filter set — powers the stat cards. */
    public function stats(Request $request): JsonResponse
    {
        $total = $this->filtered($request)->count();
        // "Taken" = ever accepted, even if later canceled. Pending offers fold into
        // "not taken" (declined) per the product decision. Earnings count COMPLETED
        // trips only, summed from the numeric fare column.
        $accepted = $this->filtered($request)->taken()->count();
        $completed = $this->filtered($request)->completed()->count();
        $earnings = (float) $this->filtered($request)->completed()->sum('fare_amount');

        return response()->json(['data' => [
            'total' => $total,
            'accepted' => $accepted,
            'declined' => $total - $accepted,
            'completed' => $completed,
            'acceptance_rate' => $total > 0 ? (int) round($accepted / $total * 100) : 0,
            'earnings' => round($earnings, 2),
        ]]);
    }

    /** The offer query with the list's filters applied (search/driver/date). */
    private function filtered(Request $request): Builder
    {
        return DispatchOffer::query()
            ->when($request->filled('driver_uuid'), fn ($q) => $q->where('driver_uuid', $request->string('driver_uuid')))
            ->when($request->filled('driver_uuids'), fn ($q) => $q->whereIn('driver_uuid', (array) $request->input('driver_uuids')))
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
            ->when($request->filled('from'), fn ($q) => $q->whereDate('received_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('received_at', '<=', $request->date('to')));
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
        $results = ['routed' => 0, 'unlinked_driver' => 0, 'duplicate' => 0, 'skipped_no_uuid' => 0, 'error' => 0];

        foreach ($data['offers'] as $offer) {
            try {
                $outcome = $ingestor->ingest($tenantId, $offer, $data['seq'] ?? null);
                $results[$outcome['status']] = ($results[$outcome['status']] ?? 0) + 1;
            } catch (\Throwable $e) {
                // One malformed/failed offer must never drop the rest of the batch.
                $results['error']++;
                RidyLog::event('dispatch_offer.ingest_error', ['error' => $e->getMessage()]);
            }
        }

        return response()->json(['data' => $results]);
    }

    /**
     * Full detail for one offer: the raw Uber payload plus a geocoded trip
     * (pickup/dropoff coordinates, road route, distance and price-per-km) —
     * computed once via free services and cached on the row.
     */
    public function show(Request $request, DispatchOffer $offer, TripGeocoder $geocoder): JsonResponse
    {
        $geocoder->enrich($offer);

        return response()->json([
            'data' => array_merge(
                (new DispatchOfferResource($offer))->toArray($request),
                [
                    'raw' => $offer->raw_payload,
                    'trip' => $this->trip($offer),
                ],
            ),
        ]);
    }

    /** @return array<string, mixed> */
    private function trip(DispatchOffer $offer): array
    {
        $distanceKm = $offer->distance_m !== null ? round($offer->distance_m / 1000, 2) : null;
        $fare = $this->fareAmount($offer->fare_formatted);
        $pricePerKm = ($fare !== null && $distanceKm) ? round($fare / $distanceKm, 2) : null;

        return [
            'pickup' => $offer->pickup_lat !== null
                ? ['lat' => $offer->pickup_lat, 'lng' => $offer->pickup_lng] : null,
            'dropoff' => $offer->dropoff_lat !== null
                ? ['lat' => $offer->dropoff_lat, 'lng' => $offer->dropoff_lng] : null,
            'pickup_address' => $offer->pickup_address,
            'dropoff_address' => $offer->dropoff_address,
            'route_geometry' => $offer->route_geometry, // GeoJSON LineString or null
            'distance_km' => $distanceKm,
            'fare_amount' => $fare,
            'price_per_km' => $pricePerKm,
        ];
    }

    /** Parse "6,43 €" / "$6.43" into a float (handles German comma decimals). */
    private function fareAmount(?string $formatted): ?float
    {
        if (! $formatted) {
            return null;
        }
        $n = preg_replace('/[^0-9,.]/', '', $formatted);
        // If both separators exist, the last one is the decimal separator.
        if (str_contains($n, ',') && str_contains($n, '.')) {
            $n = strrpos($n, ',') > strrpos($n, '.')
                ? str_replace('.', '', $n) : $n;
        }
        $n = str_replace(',', '.', $n);

        return is_numeric($n) ? (float) $n : null;
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
