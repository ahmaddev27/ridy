<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\AutoDeclineSettings;
use App\Domain\Fleet\LiveFleetPositions;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\TenantDriverOptions;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\FleetUpdateAutoDeclineRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Manager mode of the driver app (behind `driver.manager`): a company admin who is
 * also a driver sees and steers their own company's drivers. The ONLY write is the
 * Early-decline permission + rules (golden rule #1) — never an offer action. Every
 * query is scoped by the manager's own tenant_id, taken off the token.
 */
class ManagerController extends Controller
{
    public function __construct(private AutoDeclineSettings $settings) {}

    public function autoDeclineDrivers(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settings->allDriversWithState($request->user()->tenant)]);
    }

    /** `{driver}` is resolved inside the manager's tenant, so another company's driver is a 404. */
    public function updateAutoDecline(FleetUpdateAutoDeclineRequest $request, int $driver): JsonResponse
    {
        $manager = $request->user();
        abort_unless($manager->tenant?->dispatchRejectEnabled() === true, 403, 'dispatch_reject_disabled');

        return response()->json(['data' => $this->settings->adminUpdate(
            $this->tenantDriver($manager, $driver),
            $request->validated(),
        )]);
    }

    /** The company's drivers (id + name), e.g. for a picker. */
    public function drivers(Request $request, TenantDriverOptions $options): JsonResponse
    {
        return response()->json(['data' => $options->forTenant((int) $request->user()->tenant_id)]);
    }

    public function live(Request $request, LiveFleetPositions $positions): JsonResponse
    {
        return response()->json(['data' => $positions->forTenant((int) $request->user()->tenant_id)]);
    }

    private function tenantDriver(Driver $manager, int $driverId): Driver
    {
        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $manager->tenant_id)
            ->findOrFail($driverId);
    }
}
