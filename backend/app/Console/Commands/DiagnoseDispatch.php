<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Read-only health report that explains *why* a company's offers land as
 * "not taken": acceptance is inferred from the daemon's live driver-status
 * poll, so a stale/unusable session means every offer expires to REJECTED.
 * For each tenant it prints session liveness, roster size, and the offer
 * status breakdown over a window — the diagnostic for "one company works,
 * another rejects everything".
 */
class DiagnoseDispatch extends Command
{
    protected $signature = 'dispatch:diagnose {--hours=24 : Offer window to summarise}';

    protected $description = 'Report per-company session health and offer status breakdown.';

    /** Beyond this with no daemon event, the live status poll is effectively dead. */
    private const STALE_EVENT_MINUTES = 10;

    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $since = $now->subHours((int) $this->option('hours'));

        $tenants = Tenant::query()->orderBy('id')->get();
        if ($tenants->isEmpty()) {
            $this->warn('No tenants found.');

            return self::SUCCESS;
        }

        $rows = [];
        foreach ($tenants as $tenant) {
            $session = UberFleetSession::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->latest('last_event_at')
                ->first();

            $drivers = Driver::withoutGlobalScopes()->where('tenant_id', $tenant->id)->count();
            $linked = Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->whereNotNull('uber_driver_uuid')
                ->count();

            $breakdown = DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->where('received_at', '>=', $since)
                ->selectRaw('status, count(*) as c')
                ->groupBy('status')
                ->pluck('c', 'status');

            $total = (int) $breakdown->sum();
            $taken = 0;
            foreach ($breakdown as $status => $c) {
                if (OfferStatus::from($status)->isTaken()) {
                    $taken += (int) $c;
                }
            }

            $lastEvent = $session?->last_event_at;
            $ageMin = $lastEvent ? (int) $lastEvent->diffInMinutes($now) : null;
            $sessionState = $this->sessionState($session, $ageMin);

            $rows[] = [
                'tenant' => "#{$tenant->id} ".mb_strimwidth((string) $tenant->name, 0, 22, '…'),
                'session' => $sessionState,
                'last_event' => $ageMin === null ? 'never' : "{$ageMin}m ago",
                'drivers' => "{$linked}/{$drivers}",
                'offers' => (string) $total,
                'taken%' => $total > 0 ? round($taken / $total * 100).'%' : '—',
                'p/a/s/c/r/x' => $this->miniBreakdown($breakdown),
            ];
        }

        $this->table(
            ['Company', 'Session', 'Last event', 'Linked/Drv', "Offers({$this->option('hours')}h)", 'Taken', 'pend/acc/strt/cmpl/cncl/rej'],
            array_map(fn ($r) => array_values($r), $rows),
        );

        $this->newLine();
        $this->line('<fg=gray>A company with a stale/needs_relink session and 0% taken has a dead Uber session — re-link it. "Linked/Drv" below the roster count means unlinked drivers can never be matched.</>');

        return self::SUCCESS;
    }

    private function sessionState(?UberFleetSession $session, ?int $ageMin): string
    {
        if ($session === null) {
            return '<fg=red>none</>';
        }
        if ($session->status === UberFleetSession::STATUS_NEEDS_RELINK) {
            return '<fg=red>needs_relink</>';
        }
        if (! $session->isUsable()) {
            return '<fg=red>expired</>';
        }
        if ($ageMin !== null && $ageMin > self::STALE_EVENT_MINUTES) {
            return "<fg=yellow>stale ({$ageMin}m)</>";
        }

        return '<fg=green>live</>';
    }

    private function miniBreakdown(\Illuminate\Support\Collection $b): string
    {
        return implode('/', [
            (int) $b->get(OfferStatus::Pending->value, 0),
            (int) $b->get(OfferStatus::Accepted->value, 0),
            (int) $b->get(OfferStatus::Started->value, 0),
            (int) $b->get(OfferStatus::Completed->value, 0),
            (int) $b->get(OfferStatus::Canceled->value, 0),
            (int) $b->get(OfferStatus::Rejected->value, 0),
        ]);
    }
}
