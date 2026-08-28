<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use App\Support\FleetDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The driver app home + stats: today's performance, the current in-flight offer,
 * and the recent feed — all scoped to the authenticated driver.
 */
class DriverDashboardController extends Controller
{
    public function home(Request $request): JsonResponse
    {
        $driver = $request->user();

        $active = $this->scoped($driver->id)
            ->with('driver:id,name')
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->latest('received_at')
            ->first();

        $recent = $this->scoped($driver->id)->with('driver:id,name')->latest('received_at')->limit(5)->get();

        return response()->json(['data' => [
            'driver' => [
                'name' => $driver->name,
                'online' => $driver->isOnline(),
                'engagement' => $driver->engagementStatus(), // 0 idle / 1 en-route / 2 on-trip
            ],
            'today' => $this->summary($driver->id, FleetDay::todayStart(), FleetDay::todayStart()->addDay()),
            'active_offer' => $active ? new DispatchOfferResource($active) : null,
            'recent' => DispatchOfferResource::collection($recent),
        ]]);
    }

    public function stats(Request $request): JsonResponse
    {
        $driver = $request->user();
        // Fleet-day windows (04:00 boundary): a picked date labels [date 04:00,
        // next 04:00). $to is the exclusive upper bound.
        $from = $request->filled('from')
            ? FleetDay::startOfDate($request->string('from'))
            : FleetDay::startDaysAgo(30);
        $to = $request->filled('to')
            ? FleetDay::endOfDate($request->string('to'))
            : FleetDay::todayStart()->addDay();

        return response()->json(['data' => $this->summary($driver->id, $from, $to)]);
    }

    /** @return array<string, mixed> */
    private function summary(int $driverId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $base = fn () => $this->scoped($driverId)->where('received_at', '>=', $from)->where('received_at', '<', $to);

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

    private function scoped(int $driverId): Builder
    {
        return DispatchOffer::withoutGlobalScopes()->where('driver_id', $driverId);
    }
}
