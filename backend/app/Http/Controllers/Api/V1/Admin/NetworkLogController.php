<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Super-admin maintenance: wipe the captured Network feed for ALL companies.
 * The feed is append-only diagnostic data (pruned after 48h anyway), so clearing
 * it on demand just frees space / resets the view — it never affects offers,
 * drivers, or earnings.
 */
class NetworkLogController extends Controller
{
    public function clear(): JsonResponse
    {
        $deleted = DispatchNetworkLog::query()->delete();

        return response()->json(['data' => ['deleted' => $deleted]]);
    }
}
