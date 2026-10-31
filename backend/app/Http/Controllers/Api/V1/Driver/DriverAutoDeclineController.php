<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\AutoDeclineSettings;
use App\Http\Controllers\Controller;
use App\Http\Requests\Driver\UpdateAutoDeclineRequest;
use App\Http\Requests\FleetDayRange;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * The signed-in driver's Early-decline (auto-decline) settings and history —
 * docs/25. Always scoped to the token's driver; the tenant feature gates writes.
 */
class DriverAutoDeclineController extends Controller
{
    public function __construct(private AutoDeclineSettings $settings) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->settings->show($request->user())]);
    }

    public function update(UpdateAutoDeclineRequest $request): JsonResponse
    {
        $driver = $request->user();

        if (! $this->settings->featureEnabled($driver)) {
            return response()->json(['message' => 'Auto-decline is not enabled for this company.'], 403);
        }

        $this->settings->update($driver, $request->validated());

        return response()->json(['data' => $this->settings->show($driver->refresh())]);
    }

    public function history(Request $request): AnonymousResourceCollection
    {
        $request->validate(['reason' => ['sometimes', Rule::in(AutoDeclineSettings::REASONS)]]);
        [$from, $to] = FleetDayRange::filters($request);
        $perPage = min(50, max(5, (int) $request->integer('per_page', 20)));

        $page = $this->settings
            ->history($request->user(), $request->filled('reason') ? (string) $request->string('reason') : null, $from, $to)
            ->with(['driver:id,name,online_status', 'tenant'])
            ->orderByDesc('received_at')->orderByDesc('id')
            ->paginate($perPage)
            ->withQueryString();

        return DispatchOfferResource::collection($page);
    }
}
