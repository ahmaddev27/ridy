<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\Models\Vehicle;

/**
 * Sanitizes and upserts a fleet's vehicles. Shared by the extension ingest
 * endpoint and the server-side sync, so both write identical rows.
 */
class VehicleIngestService
{
    public function __construct(private readonly SupplierNetworkRecorder $recorder) {}

    /**
     * @param  array<int, mixed>  $vehicles
     * @return int number of vehicles upserted
     */
    public function ingest(int $tenantId, array $vehicles): int
    {
        $this->recorder->vehicles($tenantId, $vehicles);
        $count = 0;

        // SANITIZE every field instead of rejecting the batch: a strict rule would
        // 422 the whole sync from the published extension over one odd value,
        // while an unsanitized array field 500'd (Array to string).
        foreach ($vehicles as $v) {
            if (! is_array($v) || empty($v['uber_vehicle_uuid'])) {
                continue;
            }
            Vehicle::updateOrCreate(
                ['tenant_id' => $tenantId, 'uber_vehicle_uuid' => $v['uber_vehicle_uuid']],
                $this->attributes($v),
            );
            $count++;
        }

        return $count;
    }

    /** @return array<string, mixed> */
    private function attributes(array $v): array
    {
        return [
            'make' => $this->text($v, 'make'),
            'model' => $this->text($v, 'model'),
            'year' => is_numeric($v['year'] ?? null) && (int) $v['year'] > 1900 && (int) $v['year'] < 2100 ? (int) $v['year'] : null,
            'license_plate' => $this->text($v, 'license_plate', 32),
            'vin' => $this->text($v, 'vin', 32),
            'color' => $this->text($v, 'color', 64),
            'color_hex' => preg_match('/^#?[0-9a-fA-F]{3,8}$/', (string) $this->text($v, 'color_hex', 9)) === 1 ? $this->text($v, 'color_hex', 9) : null,
            // Rendered as <img src> for managers/admins: https only.
            'image_url' => $this->httpsUrl($this->text($v, 'image_url', 2048)),
            'compliance_status' => $this->text($v, 'compliance_status', 64),
            'assigned_driver_uuid' => $this->text($v, 'assigned_driver_uuid', 64),
            'synced_at' => now(),
        ];
    }

    /** A scalar field as a trimmed string capped at $max chars, else null. */
    private function text(array $vehicle, string $key, int $max = 255): ?string
    {
        $value = $vehicle[$key] ?? null;
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function httpsUrl(?string $url): ?string
    {
        return $url !== null && str_starts_with(strtolower($url), 'https://') && filter_var($url, FILTER_VALIDATE_URL) !== false
            ? $url
            : null;
    }
}
