<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\System\SystemMetricsService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin host-resource snapshot (CPU / RAM / disk / network) for the
 * System Health board. Fetched on demand (a refresh button), never polled, so
 * the two-sample rate reads run only when the admin asks for them.
 */
class SystemMetricsController extends Controller
{
    public function __invoke(SystemMetricsService $metrics): JsonResponse
    {
        return response()->json(['data' => $metrics->snapshot()]);
    }
}
