<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\AutoDeclineSettings;
use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\FleetUpdateAutoDeclineRequest;
use App\Http\Requests\FleetDayRange;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * The owner dashboard's view of Early decline (docs/25): which drivers use it with
 * which rules, the fleet's Early-declined offers, and the admin's per-driver permission
 * and rule control (the driver still owns their own on/off switch).
 */
class FleetAutoDeclineController extends Controller
{
    public function __construct(private AutoDeclineSettings $settings) {}

    public function drivers(Request $request): JsonResponse
    {
        $tenant = $request->user()->tenant;

        return response()->json(['data' => [
            'feature_enabled' => $tenant?->autoDeclineFeatureEnabled() === true,
            'drivers' => $this->settings->enabledDrivers(),
        ]]);
    }

    public function driversWithState(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settings->allDriversWithState($request->user()->tenant)]);
    }

    /** `{driver}` binds through the tenant scope, so another tenant's driver is a 404. */
    public function update(FleetUpdateAutoDeclineRequest $request, Driver $driver): JsonResponse
    {
        return response()->json(['data' => $this->settings->adminUpdate($driver, $request->validated())]);
    }

    public function history(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            'reason' => ['sometimes', Rule::in(AutoDeclineSettings::REASONS)],
            'driver_id' => ['sometimes', 'integer'],
        ]);
        [$from, $to] = FleetDayRange::filters($request);
        $perPage = min(100, max(5, (int) $request->integer('per_page', 25)));

        $page = $this->settings
            ->fleetHistory(
                $request->filled('driver_id') ? $request->integer('driver_id') : null,
                $request->filled('reason') ? (string) $request->string('reason') : null,
                $from,
                $to,
            )
            ->with(['driver:id,name,online_status', 'tenant'])
            ->orderByDesc('received_at')->orderByDesc('id')
            ->paginate($perPage)
            ->withQueryString();

        return DispatchOfferResource::collection($page);
    }
}
