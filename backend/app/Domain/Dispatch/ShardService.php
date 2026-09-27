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
 *  - if a shard stays silent past {@see REASSIGN_AFTER_SECONDS} (its box died),
 *    its companies are reassigned to a live shard on the next poll — so a box
 *    failure self-recovers.
 * Admins can drain a shard (active=false) or rebalance everything evenly.
 */
class ShardService
{
    /**
     * A shard's companies move only after it has been silent this long — longer
     * than the "live" window used for NEW assignments. A shard that merely missed
     * a couple of polls keeps its streams instead of two boxes briefly holding the
     * same Uber session (split brain), and every stream restarting.
     */
    public const REASSIGN_AFTER_SECONDS = 300;

    /**
     * Set by heartbeat(): the calling shard was itself silent past the stale
     * window before this poll. After a backend/DB outage EVERY shard looks stale,
     * so the first box back must not grab everyone else's companies — it skips
     * the stranded-session sweep for this poll and lets the others check in.
     */
    private bool $callerWasStale = false;

    /** Register/refresh a daemon box by name and stamp its heartbeat. */
    public function heartbeat(string $name): DaemonShard
    {
        $shard = DaemonShard::firstOrCreate(['name' => $name], ['active' => true]);

        $previous = $shard->last_seen_at;
        $this->callerWasStale = $previous !== null
            && $previous->isBefore(CarbonImmutable::now()->subSeconds(DaemonShard::STALE_SECONDS));

        $shard->forceFill(['last_seen_at' => CarbonImmutable::now()])->save();

        return $shard;
    }

    /**
     * Assign every active company that is unassigned — or stranded on a dead or
     * drained shard — to the least-loaded live shard, keeping the load balanced.
     * Idempotent and safe to call on every poll.
     */
    public function reconcileAssignments(): void
    {
        $live = DaemonShard::live()->withCount('sessions')->get();
        if ($live->isEmpty()) {
            return; // nothing live to hold streams — leave assignments as-is
        }

        $counts = [];
        foreach ($live as $shard) {
            $counts[$shard->id] = $shard->sessions_count;
        }

        // Shards whose companies may be taken over: drained, or silent long enough
        // to be dead. None while the caller itself just came back from silence
        // (a probable backend outage, not a dead box).
        $deadIds = $this->callerWasStale ? [] : DaemonShard::query()
            ->where(fn ($q) => $q->where('active', false)
                ->orWhereNull('last_seen_at')
                ->orWhere('last_seen_at', '<', CarbonImmutable::now()->subSeconds(self::REASSIGN_AFTER_SECONDS)))
            ->pluck('id')
            ->all();

        $pending = UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->where(function ($q) use ($deadIds) {
                $q->whereNull('shard_id');
                if ($deadIds !== []) {
                    $q->orWhereIn('shard_id', $deadIds);
                }
            })
            ->get(['id', 'shard_id']);

        foreach ($pending as $session) {
            $targetId = $this->leastLoaded($counts);
            $session->forceFill(['shard_id' => $targetId])->save();
            $counts[$targetId]++;
        }
    }

    /**
     * Evenly redistribute the active companies across the live shards (admin
     * action) with the FEWEST moves: a company already on a live shard under its
     * fair share stays put, only the overflow and those on non-live shards move.
     * Every move drops a stream on one box and starts it on another a poll later,
     * so moving everything (the old id-modulo) cost up to a minute of offers per
     * company.
     *
     * @return array{moved: int, live_shards: int}
     */
    public function rebalance(): array
    {
        $live = DaemonShard::live()->orderBy('id')->get();
        if ($live->isEmpty()) {
            return ['moved' => 0, 'live_shards' => 0];
        }

        $sessions = UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->orderBy('id')
            ->get(['id', 'shard_id']);

        $target = (int) ceil($sessions->count() / $live->count());
        $counts = array_fill_keys($live->pluck('id')->all(), 0);

        $toMove = [];
        foreach ($sessions as $session) {
            $shardId = $session->shard_id !== null ? (int) $session->shard_id : null;
            if ($shardId !== null && array_key_exists($shardId, $counts) && $counts[$shardId] < $target) {
                $counts[$shardId]++; // stays where it is

                continue;
            }
            $toMove[] = $session;
        }

        foreach ($toMove as $session) {
            $targetId = $this->leastLoaded($counts);
            $session->forceFill(['shard_id' => $targetId])->save();
            $counts[$targetId]++;
        }

        return ['moved' => count($toMove), 'live_shards' => $live->count()];
    }

    /** Id of the shard with the fewest companies from a {shardId: count} map. */
    private function leastLoaded(array $counts): int
    {
        $min = min($counts);

        return (int) array_keys($counts, $min)[0];
    }
}
