<?php

namespace App\Domain\Fleet\Earnings;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Builds the per-driver earnings El-Professor asks for.
 *
 * Every lookup carries the tenant as a term (the session, the drivers, the
 * proxy all come from the token's own company), so no input can name another
 * fleet's data.
 */
class EarningsReport
{
    /** A fleet that never linked anyone must not return a thousand entries. */
    public const MAX_UNMATCHED_LISTED = 100;

    public function __construct(
        private readonly UberEarningsFetcher $fetcher,
        private readonly EarningsClassifier $classifier,
    ) {}

    /**
     * @return array{from: string, to: string, currency: string, drivers: list<array<string, mixed>>, unmatched: int, unmatched_list: list<array<string, mixed>>}
     *
     * @throws UberEarningsException
     */
    public function forTenant(Tenant $tenant, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $session = UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->whereNotNull('uber_org_uuid')
            ->latest('id')
            ->first();
        if ($session === null || ! $session->isUsable() || empty($session->supplier_cookies)) {
            throw new UberEarningsException('no_uber_session', 'No usable Uber session is connected.', 409);
        }

        $proxy = $tenant->proxy_url;
        if (! is_string($proxy) || $proxy === '') {
            // No datacenter fallback: Uber blocks those addresses.
            throw new UberEarningsException('no_proxy', 'This company has no residential proxy assigned.', 409);
        }

        // Berlin days; the end is the start of the day AFTER `to`, so `to` is whole.
        $startMs = $from->startOfDay()->getTimestampMs();
        $endMs = $to->addDay()->startOfDay()->getTimestampMs();

        $earners = $this->fetcher->fetch($session, $proxy, $startMs, $endMs);

        return $this->assemble($tenant, $from, $to, $earners);
    }

    /**
     * @param  list<array<string, mixed>>  $earners
     * @return array{from: string, to: string, currency: string, drivers: list<array<string, mixed>>, unmatched: int, unmatched_list: list<array<string, mixed>>}
     */
    public function assemble(Tenant $tenant, CarbonImmutable $from, CarbonImmutable $to, array $earners): array
    {
        $uuids = collect($earners)->pluck('earnerUuid')->filter(fn ($u) => is_string($u) && $u !== '')->unique()->values()->all();
        $drivers = Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->whereIn('uber_driver_uuid', $uuids)
            ->get(['id', 'name', 'uber_driver_uuid'])
            ->keyBy('uber_driver_uuid');

        $rows = [];
        $currency = null;
        $unmatched = 0;
        $unmatchedList = [];
        foreach ($earners as $earner) {
            $driver = $drivers->get($earner['earnerUuid'] ?? '');
            if ($driver === null) {
                $unmatched++;
                if (count($unmatchedList) < self::MAX_UNMATCHED_LISTED) {
                    $unmatchedList[] = $this->unmatchedRow($earner);
                }

                continue;
            }
            $figures = $this->classifier->classify($earner);
            $currency ??= $figures->currency;
            $rows[] = $this->row($driver, $figures);
        }

        return [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'currency' => $currency ?? 'EUR',
            'drivers' => $rows,
            'unmatched' => $unmatched,
            'unmatched_list' => $unmatchedList,
        ];
    }

    /**
     * Who to link, and nothing about their pay: no money for an earner we cannot
     * attribute, so the refusal can name them without disclosing figures.
     *
     * @param  array<string, mixed>  $earner
     * @return array<string, mixed>
     */
    private function unmatchedRow(array $earner): array
    {
        $name = $earner['earnerMetadata']['name'] ?? null;

        return [
            'name' => is_string($name) && $name !== '' ? $name : null,
            'uber_driver_uuid' => is_string($earner['earnerUuid'] ?? null) ? $earner['earnerUuid'] : null,
            'trips' => $this->classifier->classify($earner)->trips,
        ];
    }

    /** @return array<string, mixed> */
    private function row(Driver $driver, EarnerFigures $f): array
    {
        return [
            'driver_id' => (int) $driver->id,
            'uber_driver_uuid' => $driver->uber_driver_uuid,
            'name' => $driver->name,
            'fare' => EarnerFigures::money($f->fare),
            'promotion' => EarnerFigures::money($f->promotion),
            'tips' => EarnerFigures::money($f->tips),
            'cash' => EarnerFigures::money($f->cash),
            'net_outstanding' => EarnerFigures::money($f->netOutstanding),
            'trips' => $f->trips,
            'difference' => EarnerFigures::money($f->difference()),
        ];
    }
}
