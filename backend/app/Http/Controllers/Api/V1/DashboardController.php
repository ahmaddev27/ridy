<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Billing\Models\SubscriptionPeriod;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\Vehicle;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Support\FleetDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $today = FleetDay::todayStart();
        $tenant = $request->user()?->tenant;

        return response()->json(['data' => [
            'drivers' => Driver::activeFleet()->count(),
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
            'subscription' => $tenant ? $this->subscriptionSummary($tenant) : null,
        ]]);
    }

    /**
     * Subscription for the dashboard card. Redeemed codes stack as separate
     * periods, so the card shows the CURRENT period's end and days-left, plus a
     * summary of any periods queued to start once the current one ends.
     *
     * @return array<string, mixed>
     */
    private function subscriptionSummary(Tenant $tenant): array
    {
        $now = now();
        $queued = SubscriptionPeriod::where('tenant_id', $tenant->id)
            ->where('starts_at', '>', $now)
            ->get(['days', 'starts_at']);

        // The current period ends when the earliest queued period begins; with no
        // queued period it ends at the tenant's overall subscription end.
        $currentEndsAt = $queued->min('starts_at') ?? $tenant->subscription_ends_at;
        $currentDaysLeft = $currentEndsAt ? max(0, (int) ceil($now->floatDiffInDays($currentEndsAt, false))) : 0;

        return [
            'state' => $tenant->stateReason(),
            'activated_at' => $tenant->activated_at?->toIso8601String(),
            'ends_at' => $tenant->subscription_ends_at?->toIso8601String(),
            'days_left' => $tenant->daysLeft(),
            // Current period (what the ring and "renews/ends" should reflect).
            'current_ends_at' => $currentEndsAt?->toIso8601String(),
            'current_days_left' => $currentDaysLeft,
            'queued' => $queued->isEmpty() ? null : [
                'count' => $queued->count(),
                'days' => (int) $queued->sum('days'),
                'starts_at' => $queued->min('starts_at')?->toIso8601String(),
            ],
        ];
    }

    /** Offer volume for the last 7 days (zero-filled) for the dashboard trend. */
    private function offersDaily(): array
    {
        $since = FleetDay::startDaysAgo(6);
        $dayExpr = FleetDay::dateExpr('received_at');
        $counts = DispatchOffer::where('received_at', '>=', $since)
            ->groupBy(DB::raw($dayExpr))->orderBy(DB::raw($dayExpr))
            ->pluck(DB::raw('count(*) as c'), DB::raw("{$dayExpr} as day"));

        $out = [];
        for ($i = 0; $i < 7; $i++) {
            $day = $since->copy()->addDays($i)->toDateString();
            $out[] = ['date' => $day, 'count' => (int) ($counts[$day] ?? 0)];
        }

        return $out;
    }
}
