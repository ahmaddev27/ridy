<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin directory of the whole active fleet across every company: each
 * driver's live status (online + engagement), the offer they're currently on,
 * their contact details and which company they belong to. Backs the admin
 * "Drivers" page and its online / total / online-rate stat row. The active fleet
 * excludes orphaned drivers (dropped from a company roster) — those live on the
 * separate {@see OrphanDriverController} page.
 */
class DriverDirectoryController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        // A fresh query for the active fleet — drivers still on a company roster,
        // narrowed to one company when filtered (so the stat row reflects that scope).
        $fleet = fn () => Driver::withoutGlobalScopes()->activeFleet()
            ->when($request->filled('company_id'), fn ($q) => $q->where('tenant_id', (int) $request->integer('company_id')));

        $total = $fleet()->count();
        $online = $fleet()->online()->count();
        $stats = [
            'total' => $total,
            'online' => $online,
            'rate' => $total > 0 ? (int) round($online / $total * 100) : 0,
        ];

        // On-trip → en-route → online → offline, then alphabetical. This CASE sort
        // (plus the OR-of-LIKE search) can never use an index, so it always filesorts.
        $liveFirst = "CASE
                WHEN online_status LIKE '%ON_TRIP%' THEN 0
                WHEN online_status LIKE '%EN_ROUTE%' THEN 1
                WHEN online_status LIKE '%ONLINE%' THEN 2
                ELSE 3 END";

        // Deferred join: sort/paginate on id + the sort columns only, so the driver
        // JSON columns (trip_waypoints/external_ids) never hit the sort buffer (1038
        // out-of-sort-memory), then fetch the page's full rows (with tenant) by id.
        $drivers = $fleet()
            ->select('id', 'name', 'online_status')
            ->when($request->filled('status'), fn ($q) => $this->applyStatus($q, (string) $request->input('status')))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(fn ($sub) => $sub
                    ->where('name', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    ->orWhere('email', 'like', $term)
                    ->orWhere('uber_email', 'like', $term)
                    ->orWhereHas('tenant', fn ($t) => $t->where('name', 'like', $term)));
            })
            ->orderByRaw($liveFirst)->orderBy('name')->orderBy('id')
            ->paginate(min(100, max(10, (int) $request->integer('per_page', 25))))
            ->withQueryString();

        $drivers->setCollection(
            Driver::withoutGlobalScopes()
                ->whereIn('id', $drivers->pluck('id'))
                ->with('tenant:id,name')
                ->orderByRaw($liveFirst)->orderBy('name')->orderBy('id')
                ->get()
        );

        // The in-flight offer for each listed driver (accepted/started), resolved in
        // ONE query to avoid an N+1 over the page — newest first, and unique() keeps
        // that first row per driver (keyBy alone keeps the LAST, i.e. the oldest).
        $ids = $drivers->getCollection()->pluck('id')->all();
        $activeOffers = DispatchOffer::withoutGlobalScopes()
            ->whereIn('driver_id', $ids)
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->get(['id', 'driver_id', 'pickup_display', 'pickup_address', 'dropoff_display', 'dropoff_address', 'fare_formatted', 'stops_count'])
            ->unique('driver_id')
            ->keyBy('driver_id');

        $drivers->getCollection()->transform(function (Driver $d) use ($activeOffers) {
            $offer = $activeOffers->get($d->id);

            return [
                'id' => $d->id,
                'name' => $d->name,
                'company' => $d->tenant?->name,
                'company_id' => $d->tenant_id,
                'phone' => $d->phone,
                'email' => $d->email,
                'uber_email' => $d->uber_email,
                'uber_picture_url' => $d->uber_picture_url,
                'uber_rating' => $d->uber_rating,
                'uber_total_trips' => $d->uber_total_trips,
                'online' => $d->isOnline(),
                'engagement' => $d->engagementStatus(),
                'app_registered' => $d->activated_at !== null,
                'last_seen' => $d->status_synced_at?->toIso8601String(),
                'active_offer' => $offer === null ? null : [
                    'id' => $offer->id,
                    'pickup' => $offer->pickup_display ?? $offer->pickup_address,
                    'dropoff' => $offer->dropoff_display ?? $offer->dropoff_address,
                    'fare' => $offer->fare_formatted,
                    'stops_count' => (int) ($offer->stops_count ?? 0),
                ],
            ];
        });

        return response()->json($drivers->toArray() + ['stats' => $stats]);
    }

    /**
     * Narrow the query to one live-status bucket: online (any), offline, available
     * (online + idle), en_route or on_trip. An unknown value is a no-op.
     */
    private function applyStatus(Builder $query, string $status): Builder
    {
        return match ($status) {
            'online' => $query->online(),
            'offline' => $query->offline(),
            'available' => $query->where('online_status', 'like', '%ONLINE%'),
            'en_route' => $query->where('online_status', 'like', '%EN_ROUTE%'),
            'on_trip' => $query->where('online_status', 'like', '%ON_TRIP%'),
            default => $query,
        };
    }
}
