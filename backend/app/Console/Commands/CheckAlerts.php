<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Ops\AlertService;
use App\Domain\Ops\Models\AlertIncident;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Console\Command;

/**
 * Periodic operational health check. Raises (and clears) alerts for the two
 * highest-signal, actionable failures:
 *  - a fleet company's Uber session broke (expired / needs relink) → its offers
 *    stop until a manager reconnects;
 *  - an active daemon shard went stale (its box is down) → ops should look,
 *    even though the fleet auto-fails-over to live shards.
 */
class CheckAlerts extends Command
{
    protected $signature = 'alerts:check';

    protected $description = 'Detect broken fleet sessions / down shards and alert ops';

    public function handle(AlertService $alerts): int
    {
        // Isolate the two checks: one throwing (a bad row, a DB hiccup) must not
        // skip the other — a session-check failure used to blind shard alerts too.
        $ok = true;
        foreach (['checkSessions', 'checkShards'] as $check) {
            try {
                $this->{$check}($alerts);
            } catch (\Throwable $e) {
                $ok = false;
                report($e);
                $this->error("{$check} failed: {$e->getMessage()}");
            }
        }

        return $ok ? self::SUCCESS : self::FAILURE;
    }

    /** A company whose Uber session expired or needs relinking gets no offers. */
    private function checkSessions(AlertService $alerts): void
    {
        // Only companies we actually serve: a disabled/banned/expired company's broken
        // session is moot and must not page ops (its open incident resolves below).
        $sessions = UberFleetSession::withoutGlobalScopes()
            ->select(['id', 'tenant_id', 'status'])
            ->with('tenant:id,name')
            ->whereIn('status', [UberFleetSession::STATUS_EXPIRED, UberFleetSession::STATUS_NEEDS_RELINK])
            ->whereIn('tenant_id', Tenant::query()->usable()->select('id'))
            ->get();

        $broken = [];
        foreach ($sessions as $s) {
            $broken[$s->id] = true;
            $company = $s->tenant?->getAttribute('name') ?? "tenant {$s->tenant_id}";
            $alerts->open(
                "session_relink:{$s->id}",
                'session_relink',
                "Uber session broken for {$company}",
                "The Uber fleet session for \"{$company}\" is {$s->status}. Offers stop until a manager reconnects it in the dashboard.",
            );
        }

        // Resolve every OPEN incident whose session is no longer broken — recovered,
        // deleted, replaced by a new org's row, or its company lapsed. Walks open
        // incidents (few) instead of every active session (one query each).
        $open = AlertIncident::where('kind', 'session_relink')->whereNull('resolved_at')->pluck('key');
        foreach ($open as $key) {
            $id = (int) substr((string) $key, strlen('session_relink:'));
            if (! isset($broken[$id])) {
                $alerts->resolve((string) $key);
            }
        }
    }

    /** An active shard that stopped heartbeating means its daemon box is down. */
    private function checkShards(AlertService $alerts): void
    {
        foreach (DaemonShard::where('active', true)->get() as $shard) {
            // Only alert for a shard we've actually seen before (has a heartbeat)
            // that has since gone stale — not a freshly registered, never-seen one.
            $wasSeen = $shard->last_seen_at !== null;
            if ($wasSeen && ! $shard->isLive()) {
                $alerts->open(
                    "shard_down:{$shard->id}",
                    'shard_down',
                    "Daemon shard \"{$shard->name}\" is down",
                    "Shard \"{$shard->name}\" stopped heartbeating (last seen {$shard->last_seen_at?->diffForHumans()}). Its companies fail over to live shards, but the box needs attention.",
                );
            } else {
                $alerts->resolve("shard_down:{$shard->id}");
            }
        }
    }
}
