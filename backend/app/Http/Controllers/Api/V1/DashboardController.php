<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\Vehicle;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $today = now()->startOfDay();
        $tenant = $request->user()?->tenant;

        return response()->json(['data' => [
            'drivers' => Driver::count(),
            'linked_drivers' => Driver::whereNotNull('uber_driver_uuid')->count(),
            'online_drivers' => Driver::online()->count(),
            'vehicles' => Vehicle::count(),
            'offers_today' => DispatchOffer::where('received_at', '>=', $today)->count(),
            'unlinked_offers' => DispatchOffer::whereNull('driver_id')->count(),
            'offers_daily' => $this->offersDaily(),
            'fleet_session' => UberFleetSession::query()
                ->orderByDesc('last_event_at')
                ->first()
                ?->only(['uber_org_uuid', 'status', 'last_event_at', 'expires_at']),
            'subscription' => $tenant ? [
                'state' => $tenant->stateReason(),
                'activated_at' => $tenant->activated_at?->toIso8601String(),
                'ends_at' => $tenant->subscription_ends_at?->toIso8601String(),
                'days_left' => $tenant->daysLeft(),
            ] : null,
        ]]);
    }

    /** Offer volume for the last 7 days (zero-filled) for the dashboard trend. */
    private function offersDaily(): array
    {
        $since = now()->subDays(6)->startOfDay();
        $counts = DispatchOffer::where('received_at', '>=', $since)
            ->groupBy('day')->orderBy('day')
            ->pluck(DB::raw('count(*) as c'), DB::raw('date(received_at) as day'));

        $out = [];
        for ($i = 0; $i < 7; $i++) {
            $day = $since->copy()->addDays($i)->toDateString();
            $out[] = ['date' => $day, 'count' => (int) ($counts[$day] ?? 0)];
        }

        return $out;
    }
}
