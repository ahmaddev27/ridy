<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Models\User;
use App\Support\FleetDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Fleet-owner mode: a company manager/owner monitoring EVERY driver's offers
 * read-only. Mirrors the driver dashboard/offers endpoints but scopes by the
 * owner's tenant instead of a single driver. Thin — all scoping lives here,
 * aggregation reuses the same shape the driver app already renders.
 */
class FleetController extends Controller
{
    /** Tenant-wide home: today's summary, online drivers, active + recent offers. */
    public function home(Request $request): JsonResponse
    {
        $tenantId = $this->tenantId($request);

        $online = Driver::withoutGlobalScopes()->where('tenant_id', $tenantId)->online()->count();

        $active = $this->scoped($tenantId)
            ->with('driver:id,name')
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->latest('received_at')
            ->limit(10)
            ->get();

        $recent = $this->scoped($tenantId)
            ->with('driver:id,name')
            ->latest('received_at')
            ->limit(8)
            ->get();

        return response()->json(['data' => [
            'owner' => [
                'name' => $request->user()->name,
                'company_name' => $request->user()->loadMissing('tenant')->tenant?->name,
            ],
            'online_drivers' => $online,
            'today' => $this->summary($tenantId, FleetDay::todayStart(), FleetDay::todayStart()->addDay()),
            'active_offers' => DispatchOfferResource::collection($active),
            'recent' => DispatchOfferResource::collection($recent),
        ]]);
    }

    /** Tenant-wide offers feed with the same filters as the driver list. */
    public function offers(Request $request): AnonymousResourceCollection
    {
        $offers = $this->filtered($request)
            ->with('driver:id,name')
            ->orderByDesc('received_at')
            ->paginate(min(50, max(5, (int) $request->integer('per_page', 20))))
            ->withQueryString();

        return DispatchOfferResource::collection($offers);
    }

    /**
     * A single offer by id, scoped to the owner's tenant. Lets the app's offer
     * detail screen resolve an offer by id instead of scanning list page 1 (which
     * falsely reads as "expired" for anything off that page).
     */
    public function showOffer(Request $request, string $offer): DispatchOfferResource
    {
        $record = $this->scoped($this->tenantId($request))
            ->with('driver:id,name')
            ->findOrFail($offer);

        return new DispatchOfferResource($record);
    }

    /** Tenant-wide stats over an optional date range. */
    public function stats(Request $request): JsonResponse
    {
        $tenantId = $this->tenantId($request);
        // Fleet-day windows (04:00 boundary), $to exclusive.
        $from = $request->filled('from')
            ? FleetDay::startOfDate($request->string('from'))
            : FleetDay::startDaysAgo(30);
        $to = $request->filled('to')
            ? FleetDay::endOfDate($request->string('to'))
            : FleetDay::todayStart()->addDay();

        return response()->json(['data' => $this->summary($tenantId, $from, $to)]);
    }

    /** The tenant's drivers, for the offers-view driver picker (id + name only). */
    public function drivers(Request $request): JsonResponse
    {
        $drivers = Driver::withoutGlobalScopes()
            ->where('tenant_id', $this->tenantId($request))
            ->orderBy('name')
            ->get(['id', 'name']);

        return response()->json(['data' => $drivers]);
    }

    /** Owner profile, mirroring the driver `me` shape so the app can restore a session. */
    /** Update the fleet owner's own profile (User token) — the owner counterpart
     *  of the driver's PATCH /driver/me, so saving a profile never 401s them. */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'locale' => ['sometimes', 'in:de,en,ar'],
            'password' => ['sometimes', 'string', 'min:8'],
        ]);

        $owner = $request->user();
        $owner->fill(array_intersect_key($data, array_flip(['name', 'locale', 'password'])));
        $owner->save();

        return $this->me($request);
    }

    /** Revoke the owner's current app token. The driver logout route is auth:driver
     *  and would 401 an owner, leaving their token valid server-side. */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'ok']);
    }

    public function me(Request $request): JsonResponse
    {
        $owner = $request->user();
        $owner->loadMissing('tenant');

        return response()->json(['data' => [
            'id' => $owner->id,
            'name' => $owner->name,
            'email' => $owner->email,
            'locale' => $owner->locale,
            'company_name' => $owner->tenant?->name,
            // Reflect the company's active fleet session (owners have no personal
            // Uber link), so the app matches the dashboard's "Connected" status.
            'uber_linked' => UberFleetSession::withoutGlobalScopes()
                ->where('tenant_id', $owner->tenant_id)
                ->where('status', UberFleetSession::STATUS_ACTIVE)
                ->exists(),
            'is_owner' => true,
        ]]);
    }

    /** The tenant's offers with the list's filters (search / status / date range) applied. */
    private function filtered(Request $request): Builder
    {
        return $this->scoped($this->tenantId($request))
            ->when($request->filled('driver_id'), fn ($q) => $q->where('driver_id', $request->integer('driver_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('from'), fn ($q) => $q->where('received_at', '>=', FleetDay::startOfDate($request->string('from'))))
            ->when($request->filled('to'), fn ($q) => $q->where('received_at', '<', FleetDay::endOfDate($request->string('to'))))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search').'%';
                $q->where(fn ($sub) => $sub
                    ->where('rider_first_name', 'like', $term)
                    ->orWhere('pickup_address', 'like', $term)
                    ->orWhere('dropoff_address', 'like', $term));
            });
    }

    /** @return array<string, mixed> */
    private function summary(int $tenantId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $base = fn () => $this->scoped($tenantId)->where('received_at', '>=', $from)->where('received_at', '<', $to);

        $total = $base()->count();
        $accepted = $base()->whereNotNull('accepted_at')->count();
        $completed = $base()->where('status', OfferStatus::Completed)->count();
        $earnings = (float) $base()->where('status', OfferStatus::Completed)->sum('fare_amount');
        $km = (float) $base()->where('status', OfferStatus::Completed)->sum('distance_m') / 1000;

        return [
            'total' => $total,
            'accepted' => $accepted,
            'declined' => $total - $accepted,
            'completed' => $completed,
            'acceptance_rate' => $total > 0 ? (int) round($accepted / $total * 100) : 0,
            'earnings' => round($earnings, 2),
            'km' => round($km, 1),
            'daily' => $this->dailyIncome($base(), $from, $to),
        ];
    }

    /**
     * Per-fleet-day income for [from,to): one grouped SUM(fare_amount) over
     * completed offers (same status filter as `earnings`), keyed by the 04:00
     * fleet-day. Zero-filled so every day in the window is present, in order.
     *
     * @return array<int, array{date: string, income: float}>
     */
    private function dailyIncome(Builder $base, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $dateExpr = FleetDay::dateExpr('received_at');

        $incomeByDate = $base
            ->where('status', OfferStatus::Completed)
            ->selectRaw("{$dateExpr} as fleet_date, SUM(fare_amount) as income")
            ->groupBy('fleet_date')
            ->pluck('income', 'fleet_date');

        $daily = [];
        for ($cursor = $from; $cursor < $to; $cursor = $cursor->addDay()) {
            $date = $cursor->toDateString();
            $daily[] = ['date' => $date, 'income' => round((float) ($incomeByDate[$date] ?? 0), 2)];
        }

        return $daily;
    }

    private function scoped(int $tenantId): Builder
    {
        return DispatchOffer::withoutGlobalScopes()->where('tenant_id', $tenantId);
    }

    /** Ensure the caller is a tenant-bound owner/manager and return their tenant id. */
    private function tenantId(Request $request): int
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        return $user->tenant_id;
    }
}
