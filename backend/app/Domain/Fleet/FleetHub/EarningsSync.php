<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\EarnerBreakdownParser;
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
        private readonly FleetRollup $rollup,
    ) {}

    /**
     * @return int number of driver metrics upserted
     *
     * @throws UberEarningsException
     */
    public function syncTenant(Tenant $tenant, ?CarbonImmutable $now = null): int
    {
        [$session, $proxy] = $this->sessions->forTenant($tenant);
        [$startMs, $endMs] = OperatingWeek::currentMs($now ?? CarbonImmutable::now());

        $earners = $this->fetcher->fetch($session, $proxy, $startMs, $endMs);

        // Same earners, no second Uber call: the fleet roll-up is derived here.
        $this->rollup->store((int) $tenant->id, $earners);

        return $this->parser->parse((int) $tenant->id, [
            'variables' => $this->fetcher->variables($session, $startMs, $endMs, null),
            'data' => ['data' => ['getEarnerBreakdownsV2' => ['earnerEarningsBreakdowns' => $earners]]],
        ]);
    }
}
