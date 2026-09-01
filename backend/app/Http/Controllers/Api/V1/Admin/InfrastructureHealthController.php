<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\System\InfrastructureHealthService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin platform-infrastructure health (queue, scheduler, Reverb, geo) for
 * the System Health board. Cheap enough to poll, but each probe is time-boxed.
 */
class InfrastructureHealthController extends Controller
{
    public function __invoke(InfrastructureHealthService $health): JsonResponse
    {
        return response()->json(['data' => $health->snapshot()]);
    }
}
