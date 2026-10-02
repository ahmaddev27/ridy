<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use App\Domain\Dispatch\Models\FleetSessionOutage;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * One-line health view of every Uber session: is it warm (cookies being
 * refreshed from the 24/7 Fleet Hub polls), how long since its last event, and
 * how many outages it had in the window. Replaces the three ad-hoc tinker
 * queries used to confirm the keep-warm fix — and never goes silent on zero.
 */
class FleetOutageReport extends Command
{
    protected $signature = 'fleet:outage-report {--days=7 : Outage window in days}';

    protected $description = 'Report Uber session outages + keep-warm activity per company.';

    /** A session with no event in this long is suspect even if still "active". */
    private const QUIET_MINUTES = 15;

    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $days = max(1, (int) $this->option('days'));
        $since = $now->subDays($days);
        $warmSince = $now->subHours(24);

        $sessions = UberFleetSession::withoutGlobalScopes()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->orderBy('tenant_id')
            ->get();

        if ($sessions->isEmpty()) {
            $this->warn('No active sessions.');

            return self::SUCCESS;
        }

        $names = Tenant::whereIn('id', $sessions->pluck('tenant_id'))->pluck('name', 'id');

        // cookies_refreshed counts per tenant over the last 24h (the keep-warm proof).
        $warm = DispatchNetworkLog::withoutGlobalScopes()
            ->where('kind', 'session')
            ->where('created_at', '>=', $warmSince)
            ->get()
            ->filter(fn (DispatchNetworkLog $l) => ($l->payload['event'] ?? null) === 'cookies_refreshed')
            ->countBy('tenant_id');

        $rows = [];
        $openCount = 0;
        $totalDown = 0;

        foreach ($sessions as $s) {
            $outages = FleetSessionOutage::where('uber_fleet_session_id', $s->id)
                ->where('started_at', '>=', $since)
                ->get();
            $open = $outages->firstWhere('ended_at', null) !== null;
            $downSeconds = (int) $outages->sum(fn (FleetSessionOutage $o) => $o->durationSeconds($now));
            $openCount += $open ? 1 : 0;
            $totalDown += $downSeconds;

            $warmCount = (int) ($warm[$s->tenant_id] ?? 0);
            $lastEvent = $s->last_event_at;
            $quietMin = $lastEvent !== null ? (int) $lastEvent->diffInMinutes($now) : null;

            $rows[] = [
                'tenant' => $s->tenant_id,
                'company' => (string) ($names[$s->tenant_id] ?? '—'),
                'warm_24h' => $warmCount,
                'last_event' => $quietMin === null ? 'never' : $quietMin.'m ago',
                'outages_'.$days.'d' => $outages->count(),
                'down' => $this->humanDuration($downSeconds),
                'state' => $this->state($warmCount, $quietMin, $open),
            ];
        }

        $this->table(array_keys($rows[0]), $rows);
        $this->line('');
        $this->line(sprintf(
            '%d active session(s) · %d open outage(s) · %s total downtime over %dd.',
            $sessions->count(),
            $openCount,
            $this->humanDuration($totalDown),
            $days,
        ));
        $this->line('Keep-warm is healthy when every company shows warm_24h > 0 and no open outage.');

        return self::SUCCESS;
    }

    /** A quick verdict per session: OK, quiet, cold (not refreshing), or down. */
    private function state(int $warm, ?int $quietMin, bool $open): string
    {
        if ($open) {
            return 'DOWN';
        }
        if ($warm === 0) {
            return 'COLD (not refreshing)';
        }
        if ($quietMin !== null && $quietMin > self::QUIET_MINUTES) {
            return 'quiet';
        }

        return 'OK';
    }

    private function humanDuration(int $seconds): string
    {
        if ($seconds <= 0) {
            return '0m';
        }
        $h = intdiv($seconds, 3600);
        $m = intdiv($seconds % 3600, 60);

        return $h > 0 ? "{$h}h {$m}m" : "{$m}m";
    }
}
