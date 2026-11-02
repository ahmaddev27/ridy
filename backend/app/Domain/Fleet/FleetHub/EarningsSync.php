<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\EarnerBreakdownParser;
use App\Domain\Fleet\Earnings\EarningsReport;
use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\Earnings\UberEarningsFetcher;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Server-side twin of the extension's earnings capture: pulls the CURRENT Uber
 * operating week from Fleet Hub and feeds it to the SAME parser/upsert the
 * extension ingest uses, so both paths write identical DriverMetric rows.
 */
class EarningsSync
{
    public function __construct(
        private readonly FleetHubSessionResolver $sessions,
        private readonly UberEarningsFetcher $fetcher,
        private readonly EarnerBreakdownParser $parser,
    ) {}

    /**
     * @return int number of driver metrics upserted
     *
     * @throws UberEarningsException
     */
    public function syncTenant(Tenant $tenant, ?CarbonImmutable $now = null): int
    {
        [$session, $proxy] = $this->sessions->forTenant($tenant);
        [$startMs, $endMs] = $this->currentWeekMs($now ?? CarbonImmutable::now());

        $earners = $this->fetcher->fetch($session, $proxy, $startMs, $endMs);

        return $this->parser->parse((int) $tenant->id, [
            'variables' => $this->fetcher->variables($session, $startMs, $endMs, null),
            'data' => ['data' => ['getEarnerBreakdownsV2' => ['earnerEarningsBreakdowns' => $earners]]],
        ]);
    }

    /**
     * Monday 04:00 -> next Monday 04:00 Berlin. Before 04:00 the operating day
     * is still the previous calendar day, so the week is judged from now-4h.
     *
     * @return array{0: int, 1: int}
     */
    private function currentWeekMs(CarbonImmutable $now): array
    {
        $operatingDay = $now->setTimezone((string) config('app.timezone'))
            ->subHours(EarningsReport::UBER_OPERATING_DAY_START_HOUR);
        $monday = $operatingDay->startOfWeek();

        return EarningsReport::windowMs($monday, $monday->addDays(6));
    }
}
