<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchNetworkLog;
use Illuminate\Support\Arr;

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
    /** A batch of driver online/location status updates. */
    public function statuses(int $tenantId, array $statuses): void
    {
        $this->capture($tenantId, 'status', $statuses, 'Status sync — '.count($statuses).' drivers', count($statuses));
    }

    /** A roster (driver list) pull. */
    public function roster(int $tenantId, array $drivers): void
    {
        $this->capture($tenantId, 'roster', $drivers, 'Roster sync — '.count($drivers).' drivers', count($drivers));
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
