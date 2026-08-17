<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

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
    protected $signature = 'dispatch:diagnose {--hours=24 : Offer window to summarise} {--tenant= : Drill into one company (uuid match + status freshness)}';

    protected $description = 'Report per-company session health and offer status breakdown.';

    /** Beyond this with no daemon event, the live status poll is effectively dead. */
    private const STALE_EVENT_MINUTES = 10;

    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $since = $now->subHours((int) $this->option('hours'));

        if ($this->option('tenant') !== null) {
            return $this->drillTenant((int) $this->option('tenant'), $since, $now);
        }

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

    /**
     * Deep-dive one tenant to separate the two failure modes behind "0% taken"
     * despite a live session: (a) the supplier status poll is stale — drivers'
     * status_synced_at is old / everyone stuck idle, so no EN_ROUTE/ON_TRIP edge
     * is ever seen; or (b) a uuid mismatch — the RAMEN offer.driver_uuid never
     * equals any driver's uber_driver_uuid, so the offer is orphaned.
     */
    private function drillTenant(int $tenantId, CarbonImmutable $since, CarbonImmutable $now): int
    {
        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null) {
            $this->error("Tenant #{$tenantId} not found.");

            return self::FAILURE;
        }

        $this->info("Drill: #{$tenant->id} {$tenant->name}");

        // Session cookie jars — RAMEN uses `cookies`, the status/roster poll uses
        // `supplier_cookies`. A missing supplier jar = offers arrive but status never moves.
        $session = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenantId)->latest('last_event_at')->first();
        if ($session !== null) {
            $ramen = is_array($session->cookies) ? count($session->cookies) : 0;
            $supplier = is_array($session->supplier_cookies) ? count($session->supplier_cookies) : 0;
            $this->line("Session #{$session->id} status={$session->status} ramen_cookies={$ramen} <fg=".($supplier > 0 ? 'green' : 'red').">supplier_cookies={$supplier}</>");
        }

        // Drivers: is the status poll actually landing? (status_synced_at freshness + observed statuses)
        $drivers = Driver::withoutGlobalScopes()->where('tenant_id', $tenantId)->get();
        $uuids = $drivers->pluck('uber_driver_uuid')->filter()->all();
        $driverRows = $drivers->map(function (Driver $d) use ($now) {
            $age = $d->status_synced_at ? (int) CarbonImmutable::parse($d->status_synced_at)->diffInMinutes($now).'m' : 'never';

            return [
                mb_strimwidth((string) ($d->first_name ?? $d->name ?? '—'), 0, 18, '…'),
                $d->uber_driver_uuid ? substr($d->uber_driver_uuid, 0, 8).'…' : '<fg=red>UNLINKED</>',
                $d->online_status ?? '—',
                $age,
            ];
        })->all();
        $this->table(['Driver', 'uber_uuid', 'online_status', 'status_synced'], $driverRows);

        // Offer→driver uuid match: how many offers reference a uuid that exists on a driver?
        $offers = DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('received_at', '>=', $since)
            ->get(['offer_uuid', 'driver_uuid', 'driver_id', 'status', 'accept_window_seconds', 'received_at']);

        $orphans = $offers->reject(fn ($o) => in_array($o->driver_uuid, $uuids, true))->count();
        $matched = $offers->count() - $orphans;
        $this->line("Offers in window: {$offers->count()}  matched_to_driver={$matched}  <fg=".($orphans > 0 ? 'red' : 'gray').">orphan_uuid={$orphans}</>");

        // A sample so the mismatch is visible if uuids come from different namespaces.
        $sample = $offers->take(8)->map(fn ($o) => [
            substr($o->offer_uuid, 0, 8).'…',
            in_array($o->driver_uuid, $uuids, true) ? '<fg=green>'.substr($o->driver_uuid, 0, 8).'…</>' : '<fg=red>'.substr($o->driver_uuid, 0, 8).'…✗</>',
            $o->status instanceof OfferStatus ? $o->status->value : (string) $o->status,
            (int) $o->accept_window_seconds.'s',
        ])->all();
        $this->table(['offer_uuid', 'offer.driver_uuid', 'status', 'window'], $sample);

        $engaged = $drivers->filter(fn ($d) => in_array(strtoupper((string) $d->online_status), ['EN_ROUTE', 'ON_TRIP']) || str_contains(strtoupper((string) $d->online_status), 'EN_ROUTE') || str_contains(strtoupper((string) $d->online_status), 'ON_TRIP'))->count();
        $this->newLine();
        $this->line('<fg=gray>Read it as: orphan_uuid over 0 → offer.driver_uuid never matches a driver (linking/namespace bug). All status_synced=never/old or every online_status idle → the supplier status poll is not landing (check supplier_cookies). Drivers currently engaged (EN_ROUTE/ON_TRIP): '.$engaged.'.</>');

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

    private function miniBreakdown(Collection $b): string
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
