<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\OfferDispatchCommand;
use App\Domain\Dispatch\Models\UberFleetSession;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Hands queued dispatch commands to the daemon box that owns their company, and
 * sweeps the ones nobody collected in time.
 *
 * The daemon cannot poll on a timer here: a decline is worth sending only while
 * the offer's window is open, and a 1-second poll would already have spent most
 * of it. So the daemon PARKS a request ({@see awaitForShard}) and the backend
 * answers the instant a row appears — the latency a tap pays is one poll
 * INTERVAL, not one poll period.
 *
 * Parking a request means holding an FPM worker, so these two routes run on their
 * own pool (:9002, docker/php/php-fpm.d/zz-pools.conf): a parked long-poll must
 * never be able to queue an offer's ingest behind it.
 */
class DispatchCommandQueue
{
    /**
     * Ceiling on how long one request may park.
     *
     * Well inside the pool's request_terminate_timeout (60 s), and short enough
     * that a rebalance, a drained shard or a deploy is picked up promptly — the
     * daemon re-polls, and re-resolves its companies, on every return.
     */
    public const MAX_WAIT_SECONDS = 25;

    /** Commands handed out in one answer. A driver holds one live offer, so >1 only matters for a multi-driver fleet. */
    public const CLAIM_LIMIT = 5;

    /**
     * How often the park loop re-checks. 150 ms is the worst-case latency a tap
     * pays. On the production DATABASE cache/queue driver this is a plain indexed
     * SELECT rather than a cache round trip, so the loop costs one cheap query per
     * interval.
     */
    private const POLL_INTERVAL_MICROSECONDS = 150_000;

    /** Rows one expireStale() pass settles, so a backlog can never make the sweep run long. */
    private const EXPIRE_BATCH = 500;

    /**
     * Claim up to $limit commands for this shard right now, without waiting.
     *
     * @return Collection<int, OfferDispatchCommand>
     */
    public function claimForShard(DaemonShard $shard, int $limit = self::CLAIM_LIMIT): Collection
    {
        return $this->claim($this->sessionIdsFor($shard), $limit);
    }

    /**
     * Park until this shard has work, or until $waitSeconds elapses.
     *
     * The shard's companies are resolved ONCE per park rather than per poll: that
     * table changes only on a rebalance or a failover, and the loop's whole point
     * is to stay a single indexed lookup. A company assigned mid-park is therefore
     * picked up on the daemon's next poll — at most one wait later, and its first
     * command is still inside its own window because the daemon re-polls the
     * moment this returns.
     *
     * @return Collection<int, OfferDispatchCommand>
     */
    public function awaitForShard(DaemonShard $shard, int $waitSeconds): Collection
    {
        $wait = max(0, min($waitSeconds, self::MAX_WAIT_SECONDS));
        $sessionIds = $this->sessionIdsFor($shard);
        $deadline = microtime(true) + $wait;

        // One claim attempt always runs: wait=0 is a plain poll, not a no-op.
        while (true) {
            $claimed = $this->claim($sessionIds, self::CLAIM_LIMIT);

            if ($claimed->isNotEmpty() || microtime(true) >= $deadline) {
                return $claimed;
            }

            usleep(self::POLL_INTERVAL_MICROSECONDS);
        }
    }

    /**
     * Whether this shard may report on a command — i.e. it owns the session whose
     * jar has to carry the mutation.
     *
     * A command with no session, or a caller sending no shard header (single-box
     * legacy), passes: the same leniency {@see DispatchDaemonController::find}
     * applies to session writes.
     */
    public function shardOwns(OfferDispatchCommand $command, ?int $shardId): bool
    {
        if ($shardId === null || $command->uber_fleet_session_id === null) {
            return true;
        }

        $sessionShard = UberFleetSession::withoutGlobalScopes()
            ->whereKey($command->uber_fleet_session_id)
            ->value('shard_id');

        return $sessionShard === null || (int) $sessionShard === $shardId;
    }

    /**
     * Settle every command whose window closed while it was still open — queued and
     * never collected, or claimed by a box that died before reporting.
     *
     * One bulk UPDATE rather than DispatchActionService::expire() per row: this is a
     * per-minute sweep over an unbounded set, while the per-row path exists for one
     * known command. A daemon that reports late still wins, because applyResult
     * writes the real verdict over this row — which is the honest outcome.
     *
     * @return int commands expired
     */
    public function expireStale(): int
    {
        $open = [DispatchCommandStatus::Queued, DispatchCommandStatus::Claimed];

        $ids = OfferDispatchCommand::withoutGlobalScopes()
            ->whereIn('status', $open)
            ->where('expires_at', '<=', now())
            ->orderBy('id')
            ->limit(self::EXPIRE_BATCH)
            ->pluck('id');

        if ($ids->isEmpty()) {
            return 0;
        }

        return OfferDispatchCommand::withoutGlobalScopes()
            ->whereIn('id', $ids)
            ->whereIn('status', $open)
            ->update([
                'status' => DispatchCommandStatus::Expired,
                'completed_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * @param  array<int, int>  $sessionIds
     * @return Collection<int, OfferDispatchCommand>
     */
    private function claim(array $sessionIds, int $limit): Collection
    {
        if ($sessionIds === []) {
            return collect();
        }

        $candidates = OfferDispatchCommand::withoutGlobalScopes()
            ->claimable()
            ->whereIn('uber_fleet_session_id', $sessionIds)
            ->orderBy('id')
            ->limit(max(1, $limit))
            ->pluck('id');

        return $candidates
            ->map(fn ($id) => $this->claimOne((int) $id))
            ->filter()
            ->values();
    }

    /**
     * Take one command, or nothing.
     *
     * The guard IS the UPDATE's own WHERE: a single UPDATE statement is atomic, so
     * exactly one caller can see it move a queued row to claimed. Two shards — or
     * two workers of one shard — racing the same id cannot both be handed it; the
     * loser's affected-row count is 0 and it skips the row. That is why this is a
     * per-row statement and not one UPDATE across the candidate set: a batch UPDATE
     * reports only HOW MANY rows it changed, never which, so it cannot tell a
     * winner from a loser.
     */
    private function claimOne(int $id): ?OfferDispatchCommand
    {
        $won = OfferDispatchCommand::withoutGlobalScopes()
            ->whereKey($id)
            ->where('status', DispatchCommandStatus::Queued)
            ->update([
                'status' => DispatchCommandStatus::Claimed,
                'claimed_at' => now(),
                // Counted on DELIVERY, not on success: it bounds how many times this
                // offer may ever be handed to Uber, which is what MAX_ATTEMPTS means.
                'attempts' => DB::raw('attempts + 1'),
                'updated_at' => now(),
            ]);

        return $won === 1
            ? OfferDispatchCommand::withoutGlobalScopes()->find($id)
            : null;
    }

    /**
     * The sessions this box owns — the same ownership rule as
     * {@see DispatchDaemonController::sessions}, so a command only ever reaches the
     * box that actually holds its company's live jar.
     *
     * @return array<int, int>
     */
    private function sessionIdsFor(DaemonShard $shard): array
    {
        return UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->where('shard_id', $shard->id)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }
}
