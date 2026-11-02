<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Tenancy\Models\Tenant;

/** Server-side twin of the extension's vehicle sync (same rows, same upsert). */
class VehicleSync
{
    public function __construct(
        private readonly FleetHubSessionResolver $sessions,
        private readonly UberVehiclesFetcher $fetcher,
        private readonly VehicleIngestService $ingest,
    ) {}

    /**
     * @return int number of vehicles upserted
     *
     * @throws UberEarningsException
     */
    public function syncTenant(Tenant $tenant): int
    {
        [$session, $proxy] = $this->sessions->forTenant($tenant);

        return $this->ingest->ingest((int) $tenant->id, $this->fetcher->fetch($session, $proxy));
    }
}
