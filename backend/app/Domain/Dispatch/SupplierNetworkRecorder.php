<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Cache;

/**
 * The single point every inbound supplier (Uber) event flows through on its way
 * to the admin Network feed — offers, driver-status syncs and roster pulls, from
 * BOTH the dispatch daemon and the manager's browser extension.
 *
 * Centralising the capture here means each ingest path logs by calling ONE method
 * with an identical shape, so the daemon and extension feeds never drift, and a
 * newly added supplier endpoint can never silently skip the feed. Best-effort
 * throughout: capturing a request must never break ingestion, so every write is
 * swallowed on failure. The payload is stored raw — exactly as the supplier sent
 * it, before any ingest, geocoding, or normalisation.
 */
class SupplierNetworkRecorder
{
    /** At most one unchanged status row per company per this many seconds. */
    private const STATUS_THROTTLE_SECONDS = 60;

    /** Roster fields that identify/contact a person — never kept in the debug feed. */
    private const ROSTER_PII_KEYS = ['email', 'phoneNumber', 'phone', 'pictureUrl', 'picture'];

    /**
     * A batch of driver status updates — stored WITHOUT positions ("detect, don't
     * surveil"): the debug feed needs who/what status/when, not a 48 h GPS trail at
     * the 3 s engaged cadence. Throttled to one row a minute per company unless a
     * status actually changed or a trip shows an extra stop (the multi-stop audit).
     */
    public function statuses(int $tenantId, array $statuses): void
    {
        $rows = array_map(fn ($row) => $this->statusSummary($row), array_values(array_filter($statuses, 'is_array')));

        if (! $this->statusRowDue($tenantId, $rows)) {
            return;
        }

        $this->capture($tenantId, 'status', $rows, 'Status sync — '.count($statuses).' drivers', count($statuses));
    }

    /** A roster (driver list) pull — contact details and pictures stripped. */
    public function roster(int $tenantId, array $drivers): void
    {
        $rows = array_map(fn ($row) => is_array($row) ? Arr::except($row, self::ROSTER_PII_KEYS) : $row, $drivers);

        $this->capture($tenantId, 'roster', $rows, 'Roster sync — '.count($drivers).' drivers', count($drivers));
    }

    /**
     * One status row as the feed keeps it: identity, status and fix time, a
     * has_location flag and the waypoint types (no coordinates, no heading).
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function statusSummary(array $row): array
    {
        $lat = $row['latitude'] ?? null;
        $waypoints = is_array($row['waypoints'] ?? null) ? $row['waypoints'] : [];

        return [
            'driver_uuid' => $row['driver_uuid'] ?? null,
            'status' => $row['status'] ?? null,
            'location_updated_at' => $row['location_updated_at'] ?? null,
            'has_location' => is_numeric($lat) && abs((float) $lat) >= 0.0001,
            'waypoints' => array_map(fn ($w) => is_array($w) && is_scalar($w['type'] ?? null) ? (string) $w['type'] : null, $waypoints),
        ];
    }

    /**
     * Whether this status batch should be written: the first in the throttle
     * window, or one that changes a driver's status, or one carrying a VIA stop.
     *
     * @param  array<int, array<string, mixed>>  $rows
     */
    private function statusRowDue(int $tenantId, array $rows): bool
    {
        $statusMap = [];
        $hasVia = false;
        foreach ($rows as $row) {
            $statusMap[(string) $row['driver_uuid']] = $row['status'];
            foreach ($row['waypoints'] as $type) {
                $hasVia = $hasVia || str_contains(strtoupper((string) $type), 'VIA');
            }
        }
        ksort($statusMap);
        $hash = md5((string) json_encode($statusMap));

        return (bool) rescue(function () use ($tenantId, $hash, $hasVia) {
            $changed = Cache::get("netlog:status-hash:{$tenantId}") !== $hash;
            Cache::put("netlog:status-hash:{$tenantId}", $hash, self::STATUS_THROTTLE_SECONDS * 10);

            return Cache::add("netlog:status:{$tenantId}", 1, self::STATUS_THROTTLE_SECONDS) || $changed || $hasVia;
        }, true, report: false);
    }

    /** A fleet vehicle sync. */
    public function vehicles(int $tenantId, array $vehicles): void
    {
        $this->capture($tenantId, 'vehicle', $vehicles, 'Vehicle sync — '.count($vehicles).' vehicles', count($vehicles));
    }

    /** One driver's earnings/metrics window. */
    public function metric(int $tenantId, array $metric, ?string $driver = null): void
    {
        $this->capture($tenantId, 'metric', $metric, 'Driver metrics'.($driver !== null && $driver !== '' ? ' — '.$driver : ''));
    }

    /**
     * A session-lifecycle event (link / cookie refresh / needs-relink). The
     * payload is metadata ONLY — never cookie values, which are secrets — so the
     * Network feed can show that a session changed without exposing credentials.
     *
     * @param  array<string, mixed>  $meta
     */
    public function session(int $tenantId, string $event, array $meta = []): void
    {
        $this->capture($tenantId, 'session', ['event' => $event] + $meta, 'Session — '.$event);
    }

    /** One raw offer, exactly as the supplier sent it (pre-ingest, pre-geocode). */
    public function offer(int $tenantId, array $offer): void
    {
        // The same offer can arrive on two paths at once (the daemon stream AND the
        // manager's extension). De-duplicate on offerUUID within a short window so
        // the Network feed shows it once, not twice.
        $uuid = (string) Arr::get($offer, 'offerUUID', '');
        if ($uuid !== '') {
            // Dedup on the indexed offer_uuid column (cheap index seek) rather than
            // scanning the JSON payload on every ingest.
            $seen = rescue(fn () => DispatchNetworkLog::where('tenant_id', $tenantId)
                ->where('kind', 'offer')
                ->where('offer_uuid', $uuid)
                ->where('created_at', '>=', now()->subSeconds(20))
                ->exists(), false, report: false);
            if ($seen) {
                return;
            }
        }

        $this->capture(
            $tenantId,
            'offer',
            $offer,
            trim((string) Arr::get($offer, 'pickupAddress')).' → '.trim((string) Arr::get($offer, 'dropoffAddress')),
            null,
            $uuid !== '' ? $uuid : null,
        );
    }

    /** Persist one captured request. Best-effort — logging never breaks ingestion. */
    public function capture(?int $tenantId, string $kind, mixed $payload, ?string $summary, ?int $count = null, ?string $offerUuid = null): void
    {
        rescue(fn () => DispatchNetworkLog::record($tenantId, $kind, $payload, $summary, $count, $offerUuid), report: false);
    }
}
