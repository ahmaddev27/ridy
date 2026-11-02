<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\Earnings\UberEarningsException;

/**
 * Pulls the fleet's vehicles from Fleet Hub's SearchVehicles and normalizes
 * them to the rows VehicleIngestService takes (the shape the extension posts).
 *
 * The document has no page arguments (`orgUUID`, `filters` only), exactly as
 * the extension sends it: one un-paginated call. If Uber ever caps the answer
 * the sync would silently see a partial fleet, so the caller logs the count.
 */
class UberVehiclesFetcher
{
    private const OPERATION = 'SearchVehicles';

    /** Transcribed from extension/background.js SEARCH_VEHICLES_QUERY. */
    public const QUERY = <<<'GRAPHQL'
query SearchVehicles($orgUUID: String, $filters: SearchVehicleFilters, $withAssignments: Boolean!) {
  SearchSupplierVehicles(orgUUID: $orgUUID, filters: $filters) {
    vehicles { uuid make model year licensePlate vin color colorHexCode imageURL compliance { status } assignments @include(if: $withAssignments) { entityUUID } }
  }
}
GRAPHQL;

    public function __construct(private readonly FleetHubClient $client) {}

    /**
     * @return list<array<string, mixed>>
     *
     * @throws UberEarningsException
     */
    public function fetch(UberFleetSession $session, string $proxyUrl): array
    {
        $body = $this->client->query($session, $proxyUrl, self::OPERATION, self::QUERY, [
            'orgUUID' => $session->uber_org_uuid,
            'filters' => (object) [],
            'withAssignments' => true,
        ]);

        $vehicles = $body['data']['SearchSupplierVehicles']['vehicles'] ?? null;
        if (! is_array($vehicles)) {
            throw new UberEarningsException('unexpected_response', 'No SearchSupplierVehicles block in the answer.');
        }

        return array_values(array_map(fn ($v) => $this->normalize($v), array_filter($vehicles, 'is_array')));
    }

    /** @return array<string, mixed> same mapping as the extension's fetchVehicles() */
    private function normalize(array $v): array
    {
        $hex = $v['colorHexCode'] ?? null;

        return [
            'uber_vehicle_uuid' => $v['uuid'] ?? null,
            'make' => $v['make'] ?? null,
            'model' => $v['model'] ?? null,
            'year' => ! empty($v['year']) ? $v['year'] : null,
            'license_plate' => $v['licensePlate'] ?? null,
            'vin' => $v['vin'] ?? null,
            'color' => $v['color'] ?? null,
            'color_hex' => is_scalar($hex) && $hex !== '' ? '#'.ltrim((string) $hex, '#') : null,
            'image_url' => $v['imageURL'] ?? null,
            'compliance_status' => $v['compliance']['status'] ?? null,
            'assigned_driver_uuid' => $v['assignments'][0]['entityUUID'] ?? null,
        ];
    }
}
