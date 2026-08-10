<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\Vehicle;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $today = now()->startOfDay();

        return response()->json(['data' => [
            'drivers' => Driver::count(),
            'linked_drivers' => Driver::whereNotNull('uber_driver_uuid')->count(),
            'online_drivers' => Driver::where(fn ($q) => $q
                ->where('online_status', 'like', '%ONLINE%')
                ->orWhere('online_status', 'like', '%ON_TRIP%'))->count(),
            'vehicles' => Vehicle::count(),
            'offers_today' => DispatchOffer::where('received_at', '>=', $today)->count(),
            'unlinked_offers' => DispatchOffer::whereNull('driver_id')->count(),
            'offers_daily' => $this->offersDaily(),
            'fleet_session' => UberFleetSession::query()
                ->orderByDesc('last_event_at')
                ->first()
                ?->only(['uber_org_uuid', 'status', 'last_event_at', 'expires_at']),
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
