<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $today = now()->startOfDay();

        return response()->json(['data' => [
            'drivers' => Driver::count(),
            'linked_drivers' => Driver::whereNotNull('uber_driver_uuid')->count(),
            'offers_today' => DispatchOffer::where('received_at', '>=', $today)->count(),
            'unlinked_offers' => DispatchOffer::whereNull('driver_id')->count(),
            'fleet_session' => UberFleetSession::query()
                ->orderByDesc('last_event_at')
                ->first()
                ?->only(['uber_org_uuid', 'status', 'last_event_at', 'expires_at']),
        ]]);
    }
}
