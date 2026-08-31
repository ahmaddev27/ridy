<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\AddressFormatter;
use App\Domain\Dispatch\DispatchOfferIngestor;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Dispatch\TripGeocoder;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Support\FleetDay;
use App\Support\RidyLog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Arr;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DispatchOfferController extends Controller
{
    use AuthorizesTenantResource;

    public function index(Request $request): AnonymousResourceCollection
    {
        $offers = $this->filtered($request)
            ->with('driver:id,name')
            ->orderByDesc('received_at')
            ->paginate(min(100, max(5, (int) $request->integer('per_page', 25))))
            ->withQueryString();

        return DispatchOfferResource::collection($offers);
    }

    /**
     * Stream the manager's offers (current filters applied) as UTF-8 CSV that
     * opens directly in Excel. Reuses the exact list filter so the export always
     * mirrors what the table shows.
     */
    public function export(Request $request): StreamedResponse
    {
        $offers = $this->filtered($request)
            ->with('driver:id,name')
            ->orderByDesc('received_at')
            ->get();

        $filename = 'offers_'.now()->toDateString().'.csv';

        return response()->streamDownload(function () use ($offers) {
            $out = fopen('php://output', 'w');
            // BOM so Excel reads UTF-8 (German/Arabic names, € symbol) correctly.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['Date', 'Rider', 'Driver', 'Pickup', 'Dropoff', 'Fare (€)', 'Distance (km)', '€/km', 'Status']);

            foreach ($offers as $offer) {
                $distanceKm = $offer->distance_m !== null ? round($offer->distance_m / 1000, 2) : null;
                $fare = $this->fareAmount($offer->fare_formatted);
                $pricePerKm = ($fare !== null && $distanceKm) ? round($fare / $distanceKm, 2) : null;

                fputcsv($out, [
                    $offer->received_at?->toDateTimeString(),
                    $offer->rider_first_name,
                    $offer->driver?->name
                        ?? (trim(($offer->driver_first_name ?? '').' '.($offer->driver_last_name ?? '')) ?: null),
                    AddressFormatter::tidy($offer->pickup_address),
                    AddressFormatter::tidy($offer->dropoff_address),
                    $fare !== null ? number_format($fare, 2, '.', '') : null,
                    $distanceKm !== null ? number_format($distanceKm, 2, '.', '') : null,
                    $pricePerKm !== null ? number_format($pricePerKm, 2, '.', '') : null,
                    $offer->displayStatus()->value,
                ]);
            }
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
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
            ->when($request->filled('from'), fn ($q) => $q->where('received_at', '>=', FleetDay::startOfDate($request->string('from'))))
            ->when($request->filled('to'), fn ($q) => $q->where('received_at', '<', FleetDay::endOfDate($request->string('to'))));
    }

    /**
     * The Ridy extension holds the RAMEN stream in the manager's own browser
     * (real IP, so Uber responds — our datacenter IP is blocked) and posts the
     * offers it sees here. Ingestion is idempotent on offer_uuid, so the same
     * offer arriving from the stream more than once is de-duplicated.
     */
    public function ingest(Request $request, DispatchOfferIngestor $ingestor, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'offers' => ['required', 'array'],
            'offers.*' => ['array'],
            'seq' => ['nullable', 'integer'],
        ]);

        $tenant = $request->user()->tenant;
        $tenantId = (int) $tenant->id;
        $results = ['routed' => 0, 'unlinked_driver' => 0, 'duplicate' => 0, 'skipped_no_uuid' => 0, 'org_mismatch' => 0, 'error' => 0];

        foreach ($data['offers'] as $offer) {
            // Capture EVERY inbound offer for the admin Network feed first — before
            // the org filter or ingestion — so it reflects real supplier traffic
            // even when an offer is later skipped (org mismatch) or fails to ingest.
            $recorder->offer($tenantId, $offer);

            // Only accept offers from THIS company's own Uber org — never a
            // different account the manager happens to have open in another tab.
            $partnerUuid = (string) Arr::get($offer, 'partnerUUID', '');
            if ($tenant->uber_org_uuid !== null && $partnerUuid !== '' && $partnerUuid !== $tenant->uber_org_uuid) {
                $results['org_mismatch']++;

                continue;
            }

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
        $this->authorizeTenant($offer);

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
        // Prefer the authoritative numeric fare column (the same one earnings sum
        // over); only fall back to parsing the formatted string when it is unset.
        // Otherwise a completed offer whose fare_formatted is blank shows "—" for
        // price/km even though its fare is known.
        $fare = $offer->fare_amount !== null
            ? (float) $offer->fare_amount
            : $this->fareAmount($offer->fare_formatted);
        $pricePerKm = ($fare !== null && $distanceKm) ? round($fare / $distanceKm, 2) : null;

        return [
            'pickup' => $offer->pickup_lat !== null
                ? ['lat' => $offer->pickup_lat, 'lng' => $offer->pickup_lng] : null,
            'dropoff' => $offer->dropoff_lat !== null
                ? ['lat' => $offer->dropoff_lat, 'lng' => $offer->dropoff_lng] : null,
            // Same source as the list resource — the supplier's ORIGINAL address
            // from the raw payload — so the detail modal and the row read identical,
            // and legacy offers whose columns were rewritten still show correctly.
            'pickup_address' => $offer->pickup_display ?? AddressFormatter::tidy(Arr::get($offer->raw_payload, 'pickupAddress') ?: $offer->pickup_address),
            'dropoff_address' => $offer->dropoff_display ?? AddressFormatter::tidy(Arr::get($offer->raw_payload, 'dropoffAddress') ?: $offer->dropoff_address),
            'route_geometry' => $offer->route_geometry, // GeoJSON LineString or null
            'distance_km' => $distanceKm,
            'fare_amount' => $fare,
            'price_per_km' => $pricePerKm,
            // How precisely the trip was located: exact|street|area|postal|approx|
            // estimated. Lets the UI flag a rough distance instead of implying it's exact.
            'geo_confidence' => $offer->geo_confidence,
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
        $this->authorizeTenant($offer);

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
