<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Tenancy\SystemHealthService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin "System Health" board: every company with the live status of each
 * critical subsystem (subscription, Uber session, dispatch daemon, proxy).
 */
class SystemHealthController extends Controller
{
    public function __invoke(SystemHealthService $health): JsonResponse
    {
        return response()->json(['data' => $health->report()]);
    }
}
