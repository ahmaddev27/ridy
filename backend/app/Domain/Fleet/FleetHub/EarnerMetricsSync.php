<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Fleet\DriverMetricWriter;
use App\Domain\Fleet\Earnings\UberEarningsException;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;

/**
 * Server-side twin of the extension's fetchMetrics: one GetEarnerMetrics call
 * per linked driver for the current operating week, stored through the same
 * {@see DriverMetricWriter} the extension ingest uses.
 */
class EarnerMetricsSync
{
    public const METRIC_MAP = [
        'SUPPLY_METRIC_TOTAL_EARNINGS' => 'earnings',
        'SUPPLY_METRIC_TOTAL_EARNINGS_LABEL' => 'earnings_label',
        'SUPPLY_METRIC_TRIP_COUNT' => 'trips',
        'SUPPLY_METRIC_HOURS_ONLINE' => 'hours_online',
        'SUPPLY_METRIC_HOURS_ON_TRIP' => 'hours_on_trip',
        'SUPPLY_METRIC_ACCEPTANCE_RATE' => 'acceptance_rate',
        'SUPPLY_METRIC_CANCELLATION_RATE' => 'cancellation_rate',
    ];

    /** Aborting the tenant on these is right; any other failure is per-driver. */
    private const FATAL_REASONS = ['uber_session_rejected', 'uber_unreachable'];

    public function __construct(
        private readonly FleetHubSessionResolver $sessions,
        private readonly FleetHubClient $client,
        private readonly DriverMetricWriter $writer,
    ) {}

    /**
     * @param  int  $budgetSeconds  stop starting new calls after this long (the job has a hard timeout)
     * @return int number of drivers stored
     *
     * @throws UberEarningsException session-level failures only
     */
    public function syncTenant(Tenant $tenant, ?CarbonImmutable $now = null, int $budgetSeconds = 60): int
    {
        [$session, $proxy] = $this->sessions->forTenant($tenant);
        [$startMs, $endMs] = OperatingWeek::currentMs($now ?? CarbonImmutable::now());
        $deadline = microtime(true) + $budgetSeconds;
        $delayUs = max(0, (int) config('services.uber.metrics_delay_ms', 400)) * 1000;

        $stored = 0;
        foreach ($this->drivers($tenant) as $driver) {
            if (microtime(true) >= $deadline) {
                break; // stalest go first, so the next run continues with the rest
            }
            $stored += $this->syncDriver($session, $proxy, $driver, $startMs, $endMs) ? 1 : 0;
            if ($delayUs > 0) {
                usleep($delayUs);
            }
        }

        return $stored;
    }

    /** @throws UberEarningsException only for session-level failures */
    private function syncDriver(UberFleetSession $session, string $proxy, Driver $driver, int $startMs, int $endMs): bool
    {
        try {
            $this->writer->write($driver, $this->fetch($session, $proxy, $driver, $startMs, $endMs));

            return true;
        } catch (UberEarningsException $e) {
            if (in_array($e->reason, self::FATAL_REASONS, true)) {
                throw $e;
            }
            Log::warning('fleethub.metrics_driver_failed', ['driver' => $driver->id, 'reason' => $e->reason]);

            return false;
        }
    }

    /** Linked drivers, never-synced first, then stalest first. */
    private function drivers(Tenant $tenant)
    {
        $lastSync = '(select max(synced_at) from driver_metrics where driver_metrics.driver_id = drivers.id)';

        return Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->whereNotNull('uber_driver_uuid')
            ->activeFleet()
            ->orderByRaw($lastSync.' is not null')
            ->orderByRaw($lastSync)
            ->get();
    }

    /**
     * @return array<string, mixed>
     *
     * @throws UberEarningsException
     */
    private function fetch(UberFleetSession $session, string $proxy, Driver $driver, int $startMs, int $endMs): array
    {
        $body = $this->client->post($session, $proxy, '/api/GetEarnerMetrics?localeCode=de-DE', [
            'orgUuid' => ['value' => $session->uber_org_uuid],
            'driverUuid' => ['value' => $driver->uber_driver_uuid],
            'timeRange' => ['startsAt' => ['value' => (string) $startMs], 'endsAt' => ['value' => (string) $endMs]],
            'metrics' => array_keys(self::METRIC_MAP),
        ]);
        if (($body['status'] ?? null) !== 'success') {
            throw new UberEarningsException('metrics_failed', 'GetEarnerMetrics did not succeed.');
        }

        return $this->normalize($body['data']['metrics'] ?? [], $startMs, $endMs);
    }

    /**
     * Uber nests the value one level deep, e.g. {doubleValue: {value: 4403.89}}.
     *
     * @return array<string, mixed>
     */
    private function normalize(mixed $metrics, int $startMs, int $endMs): array
    {
        $out = ['period_start' => $startMs, 'period_end' => $endMs];
        foreach (is_array($metrics) ? $metrics : [] as $m) {
            $field = self::METRIC_MAP[$m['metricName'] ?? ''] ?? null;
            if ($field === null) {
                continue;
            }
            $v = $m['metricValue'] ?? [];
            $raw = $v['doubleValue'] ?? $v['int64Value'] ?? $v['stringValue'] ?? null;
            $out[$field] = is_array($raw) ? ($raw['value'] ?? null) : $raw;
        }

        return $out;
    }
}
