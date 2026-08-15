<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
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
        $todayStart = CarbonImmutable::now()->startOfDay();

        $active = $this->scoped($driver->id)
            ->whereIn('status', [OfferStatus::Accepted, OfferStatus::Started])
            ->latest('received_at')
            ->first();

        $recent = $this->scoped($driver->id)->latest('received_at')->limit(5)->get();

        return response()->json(['data' => [
            'driver' => [
                'name' => $driver->name,
                'online' => $driver->isOnline(),
                'engagement' => $driver->engagementStatus(), // 0 idle / 1 en-route / 2 on-trip
            ],
            'today' => $this->summary($driver->id, $todayStart, CarbonImmutable::now()),
            'active_offer' => $active ? new DispatchOfferResource($active) : null,
            'recent' => DispatchOfferResource::collection($recent),
        ]]);
    }

    public function stats(Request $request): JsonResponse
    {
        $driver = $request->user();
        $from = $request->filled('from')
            ? CarbonImmutable::parse($request->string('from'))->startOfDay()
            : CarbonImmutable::now()->subDays(30)->startOfDay();
        $to = $request->filled('to')
            ? CarbonImmutable::parse($request->string('to'))->endOfDay()
            : CarbonImmutable::now()->endOfDay();

        return response()->json(['data' => $this->summary($driver->id, $from, $to)]);
    }

    /** @return array<string, mixed> */
    private function summary(int $driverId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $base = fn () => $this->scoped($driverId)->whereBetween('received_at', [$from, $to]);

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
        ];
    }

    private function scoped(int $driverId): Builder
    {
        return DispatchOffer::withoutGlobalScopes()->where('driver_id', $driverId);
    }
}
