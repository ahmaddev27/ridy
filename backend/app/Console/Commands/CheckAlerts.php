<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DaemonShard;
use App\Domain\Dispatch\Models\FleetSessionOutage;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Ops\AlertService;
use App\Domain\Ops\Models\AlertIncident;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Periodic operational health check. Raises (and clears) alerts for the
 * highest-signal, actionable failures:
 *  - a fleet company's Uber session broke (expired / needs relink) → its offers
 *    stop until a manager reconnects;
 *  - an active daemon shard went stale (its box is down) → ops should look,
 *    even though the fleet auto-fails-over to live shards;
 *  - an active session's Uber token is about to expire, while renewal is still
 *    possible (the manager's browser must be open to receive a new one).
 */
class CheckAlerts extends Command
{
    /** Half the measured 24h jwt-session lifetime; see checkTokenExpiries(). */
    private const TOKEN_WARN_HOURS = 12;

    /** @var array<string, string> expiry column => label used in the email */
    private const TOKEN_COLUMNS = [
        'session_token_expires_at' => 'jwt-session (offer stream)',
        'supplier_token_expires_at' => 'sp-jwt-session (Fleet Hub)',
    ];

    protected $signature = 'alerts:check';

    protected $description = 'Detect broken fleet sessions / down shards and alert ops';

    public function handle(AlertService $alerts): int
    {
        // Isolate the two checks: one throwing (a bad row, a DB hiccup) must not
        // skip the other — a session-check failure used to blind shard alerts too.
        $ok = true;
        foreach (['checkSessions', 'checkTokenExpiries', 'checkShards'] as $check) {
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
                $this->sessionAlertBody($s, $company),
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

    /**
     * Warn BEFORE an active session's Uber token lapses.
     *
     * Window: 12h, half the measured 24h `jwt-session` lifetime — late enough not to
     * nag all day, early enough that an operator can get the manager's browser
     * open before it lapses. Only tokens NOT already expired: one that died days
     * ago (an expired jwt-session on a live session has been observed for 13 days)
     * would otherwise alert forever.
     *
     * De-duped on the expiry itself: the incident key embeds it, so the same expiry
     * emails once, while a renewed token (new expiry) can alert again later.
     * Stale incidents are closed silently — a token that renewed or expired needs
     * no "resolved" email.
     */
    private function checkTokenExpiries(AlertService $alerts): void
    {
        $now = CarbonImmutable::now();
        $horizon = $now->addHours(self::TOKEN_WARN_HOURS);
        $current = [];

        foreach (self::TOKEN_COLUMNS as $column => $label) {
            $sessions = UberFleetSession::withoutGlobalScopes()
                ->select(['id', 'tenant_id', $column])
                ->with('tenant:id,name')
                ->where('status', UberFleetSession::STATUS_ACTIVE)
                ->whereIn('tenant_id', Tenant::query()->usable()->select('id'))
                ->where($column, '>', $now)
                ->where($column, '<=', $horizon)
                ->get();

            foreach ($sessions as $s) {
                $expiry = $s->getAttribute($column);
                $key = "token_expiry:{$s->id}:{$column}:{$expiry->getTimestamp()}";
                $current[$key] = true;
                $company = $s->tenant?->getAttribute('name') ?? "tenant {$s->tenant_id}";
                $local = $expiry->timezone('Europe/Berlin')->format('d.m.Y H:i');
                $alerts->open(
                    $key,
                    'token_expiry',
                    "Uber {$label} token for {$company} expires {$local}",
                    "The Uber {$label} token for \"{$company}\" expires at {$local} (Europe/Berlin). "
                        ."Uber renews it only while the manager's browser is open and logged in to Uber.",
                );
            }
        }

        $stale = AlertIncident::where('kind', 'token_expiry')->whereNull('resolved_at')->pluck('key');
        foreach ($stale as $key) {
            if (! isset($current[$key])) {
                AlertIncident::where('key', $key)->update(['resolved_at' => $now]);
            }
        }
    }

    /**
     * What the ops email says about a broken session.
     *
     * Carries the DIAGNOSIS, not just the fact. Without it the alert said only
     * "the session is broken", so answering "why?" meant an SSH session and four
     * queries — every time. `cause` names who was refused (the daemon's own
     * /ack-/recv, the manager's browser, or an operator), which is the first thing
     * that narrows it, and the relink count says whether the extension's self-heal
     * is trying and failing rather than not trying at all.
     */
    private function sessionAlertBody(UberFleetSession $session, string $company): string
    {
        $lines = ["The Uber fleet session for \"{$company}\" is {$session->status}."];

        $outage = FleetSessionOutage::where('uber_fleet_session_id', $session->id)
            ->whereNull('ended_at')
            ->latest('started_at')
            ->first();

        if ($outage !== null) {
            $lines[] = '';
            $lines[] = 'Detected by: '.$outage->cause.'  (daemon = Uber refused OUR stream; '
                .'extension = the browser reported it; admin = flagged from the panel)';
            $lines[] = 'Started at:  '.$outage->started_at;
            $lines[] = 'Relink attempts since: '.$outage->relink_attempts;
        }

        $lines[] = '';
        $lines[] = 'Offers stop until the session is reconnected in the dashboard.';

        return implode('
', $lines);
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
