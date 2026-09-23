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
        // Delete in bounded batches rather than one unbounded DELETE: this is the
        // highest-volume table, so a single statement would hold a long MySQL
        // transaction, blow up the undo log, and risk locking/stalling ingestion.
        $total = 0;

        do {
            $ids = DispatchNetworkLog::query()->limit(5000)->pluck('id');
            $deleted = $ids->isEmpty() ? 0 : DispatchNetworkLog::whereIn('id', $ids)->delete();
            $total += $deleted;
        } while ($deleted > 0);

        return response()->json(['data' => ['deleted' => $total]]);
    }
}
