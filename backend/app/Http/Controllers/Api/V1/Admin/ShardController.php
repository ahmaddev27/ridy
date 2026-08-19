<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\ShardService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin control over daemon shards: see every daemon box, how many
 * companies it holds, whether it is live (heartbeating), drain one (active=off),
 * or rebalance the fleet evenly across live shards.
 */
class ShardController extends Controller
{
    public function index(): JsonResponse
    {
        $shards = DaemonShard::withCount('sessions')->orderBy('name')->get()
            ->map(fn (DaemonShard $s) => [
                'id' => $s->id,
                'name' => $s->name,
                'label' => $s->label,
                'active' => $s->active,
                'live' => $s->isLive(),
                'companies' => $s->sessions_count,
                'last_seen_at' => $s->last_seen_at?->toIso8601String(),
            ]);

        return response()->json(['data' => $shards]);
    }

    /** Drain/undrain a shard, or set its human label. */
    public function update(Request $request, DaemonShard $shard): JsonResponse
    {
        $data = $request->validate([
            'active' => ['sometimes', 'boolean'],
            'label' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $shard->fill($data)->save();

        return response()->json(['data' => ['id' => $shard->id, 'active' => $shard->active, 'label' => $shard->label]]);
    }

    /** Evenly redistribute all active companies across the live shards. */
    public function rebalance(ShardService $shards): JsonResponse
    {
        $shards->rebalance();

        return response()->json(['data' => ['rebalanced' => true]]);
    }
}
