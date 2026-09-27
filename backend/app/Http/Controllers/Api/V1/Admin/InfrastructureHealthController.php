<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\System\InfrastructureHealthService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

/**
 * Super-admin platform-infrastructure health (queue, scheduler, Reverb, geo) for
 * the System Health board. Cheap enough to poll, but each probe is time-boxed.
 */
class InfrastructureHealthController extends Controller
{
    /**
     * Every open admin tab polls this every 30 s; the probes hit the same Nominatim
     * the live geocoder depends on and can hold an FPM worker for seconds. All tabs
     * share one probe run per window.
     */
    private const CACHE_SECONDS = 25;

    public function __invoke(InfrastructureHealthService $health): JsonResponse
    {
        $snapshot = Cache::remember('system:infra_health.v1', self::CACHE_SECONDS, fn () => $health->snapshot());

        return response()->json(['data' => $snapshot]);
    }
}
