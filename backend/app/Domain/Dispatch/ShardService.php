<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\UberFleetSession;
use Carbon\CarbonImmutable;

/**
 * Owns how fleet sessions (companies) are distributed across daemon shards.
 *
 * The scheme is DB-driven and self-healing, not a static modulo:
 *  - each daemon box heartbeats by name on every poll (auto-registering itself);
 *  - unassigned companies flow to the least-loaded LIVE shard, so adding a box
 *    picks up new companies with no re-partition of existing ones;
 *  - if a shard goes stale (its box died), its companies are reassigned to a
 *    live shard on the next poll — so a box failure self-recovers.
 * Admins can drain a shard (active=false) or rebalance everything evenly.
 */
class ShardService
{
    /** Register/refresh a daemon box by name and stamp its heartbeat. */
    public function heartbeat(string $name): DaemonShard
    {
        $shard = DaemonShard::firstOrCreate(['name' => $name], ['active' => true]);
        $shard->forceFill(['last_seen_at' => CarbonImmutable::now()])->save();

        return $shard;
    }

    /**
     * Assign every active company that is unassigned — or stranded on a stale/
     * inactive shard — to the least-loaded live shard, keeping the load balanced.
     * Idempotent and safe to call on every poll.
     */
    public function reconcileAssignments(): void
    {
        $live = DaemonShard::live()->withCount('sessions')->get();
        if ($live->isEmpty()) {
            return; // nothing live to hold streams — leave assignments as-is
        }

        $liveIds = $live->pluck('id')->all();
        $counts = [];
        foreach ($live as $shard) {
            $counts[$shard->id] = $shard->sessions_count;
        }

        $pending = UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->where(function ($q) use ($liveIds) {
                $q->whereNull('shard_id')->orWhereNotIn('shard_id', $liveIds);
            })
            ->get(['id', 'shard_id']);

        foreach ($pending as $session) {
            $targetId = $this->leastLoaded($counts);
            $session->forceFill(['shard_id' => $targetId])->save();
            $counts[$targetId]++;
        }
    }

    /** Evenly redistribute ALL active companies across the live shards (admin action). */
    public function rebalance(): void
    {
        $live = DaemonShard::live()->orderBy('id')->get();
        if ($live->isEmpty()) {
            return;
        }

        $sessions = UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->orderBy('id')
            ->get(['id']);

        $ids = $live->pluck('id')->all();
        foreach ($sessions as $i => $session) {
            $session->forceFill(['shard_id' => $ids[$i % count($ids)]])->save();
        }
    }

    /** Id of the shard with the fewest companies from a {shardId: count} map. */
    private function leastLoaded(array $counts): int
    {
        $min = min($counts);

        return (int) array_keys($counts, $min)[0];
    }
}
