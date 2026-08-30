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

    /** One raw offer, exactly as the supplier sent it (pre-ingest, pre-geocode). */
    public function offer(int $tenantId, array $offer): void
    {
        $this->capture(
            $tenantId,
            'offer',
            $offer,
            trim((string) Arr::get($offer, 'pickupAddress')).' → '.trim((string) Arr::get($offer, 'dropoffAddress')),
        );
    }

    /** Persist one captured request. Best-effort — logging never breaks ingestion. */
    private function capture(?int $tenantId, string $kind, mixed $payload, ?string $summary, ?int $count = null): void
    {
        rescue(fn () => DispatchNetworkLog::record($tenantId, $kind, $payload, $summary, $count), report: false);
    }
}
