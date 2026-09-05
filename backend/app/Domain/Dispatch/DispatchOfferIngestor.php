<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Jobs\GeocodeOffer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Tenancy\TenantContext;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Arr;
use Throwable;

/**
 * Turns a single raw offer from the Uber RAMEN stream into a stored, driver-routed
 * DispatchOffer. Idempotent on offer_uuid — the stream repeats offers, so a repeat
 * must never create a duplicate row or fire a second notification.
 */
class DispatchOfferIngestor
{
    public function __construct(
        private TenantContext $context,
        private DispatchNotifier $notifier,
        private OfferLifecycle $lifecycle,
        private TripGeocoder $geocoder,
    ) {}

    /**
     * @param  array<string, mixed>  $offer  one entry from offers[]
     * @return array{status: string, offer_id?: int, driver_id?: int|null}
     */
    public function ingest(int $tenantId, array $offer, ?int $seq = null): array
    {
        $this->context->set($tenantId);

        try {
            return $this->route($tenantId, $offer, $seq);
        } finally {
            // Reset the request/job-lifetime tenant so a long-lived worker
            // (queue/Octane) never inherits this tenant's scope into the next
            // unit of work. Under FPM this is a harmless per-request no-op.
            $this->context->forget();
        }
    }

    /**
     * @param  array<string, mixed>  $offer
     * @return array{status: string, offer_id?: int, driver_id?: int|null}
     */
    private function route(int $tenantId, array $offer, ?int $seq = null): array
    {
        $offerUuid = (string) Arr::get($offer, 'offerUUID', '');

        if ($offerUuid === '') {
            return ['status' => 'skipped_no_uuid'];
        }

        $existing = DispatchOffer::where('offer_uuid', $offerUuid)->first();

        if ($existing !== null) {
            return ['status' => 'duplicate', 'offer_id' => $existing->id, 'driver_id' => $existing->driver_id];
        }

        $driverUuid = (string) Arr::get($offer, 'driverInfo.driverUUID', '');
        $driver = $driverUuid !== ''
            ? Driver::where('uber_driver_uuid', $driverUuid)->first()
            : null;

        try {
            $record = DispatchOffer::create([
                'tenant_id' => $tenantId,
                'driver_uuid' => $driverUuid,
                'driver_id' => $driver?->id,
                'offer_uuid' => $offerUuid,
                'real_offer_uuid' => Arr::get($offer, 'realOfferUUID'),
                'partner_uuid' => Arr::get($offer, 'partnerUUID'),
                'seq' => $seq,
                'rider_first_name' => Arr::get($offer, 'riderFirstName'),
                'driver_first_name' => Arr::get($offer, 'driverInfo.firstName'),
                'driver_last_name' => Arr::get($offer, 'driverInfo.lastName'),
                'pickup_address' => AddressFormatter::tidy(Arr::get($offer, 'pickupAddress')),
                'dropoff_address' => AddressFormatter::tidy(Arr::get($offer, 'dropoffAddress')),
                // Latinize Uber's localized fare so the number parses and displays
                // in Latin digits regardless of the captured session's language.
                'fare_formatted' => AddressNormalizer::latinizeDigits(Arr::get($offer, 'formattedUFP')),
                'fare_amount' => DriverStatsService::parseFare(AddressNormalizer::latinizeDigits(Arr::get($offer, 'formattedUFP'))) ?: null,
                'accept_window_seconds' => Arr::get($offer, 'acceptWindowInSeconds'),
                'requested_at' => $this->millisToDate(Arr::get($offer, 'requestAt')),
                'offer_generated_at' => $this->millisToDate(Arr::get($offer, 'offerGeneratedAtMs')),
                'received_at' => CarbonImmutable::now(),
                'status' => OfferStatus::Pending,
                'raw_payload' => $offer,
            ]);
        } catch (QueryException $e) {
            // The same offer arrives near-simultaneously on two RAMEN channels; the
            // loser hits the unique(tenant_id, offer_uuid) index. That's a duplicate,
            // not an error — never lose the batch over it.
            $dupe = DispatchOffer::where('offer_uuid', $offerUuid)->first();
            if ($dupe !== null) {
                return ['status' => 'duplicate', 'offer_id' => $dupe->id, 'driver_id' => $dupe->driver_id];
            }
            throw $e;
        }

        // A driver holds one live offer at a time — Uber sends the next only once
        // the previous is gone. So this new offer supersedes (→ rejected) any older
        // still-pending offer of theirs, whether idle or on a trip.
        if ($driverUuid !== '') {
            $this->lifecycle->supersedePendingFor($tenantId, $driverUuid, $record->id);
        }

        // Notify the driver's devices as soon as the offer is routed. The 5-second
        // accept window makes this notification time-sensitive — but a push failure
        // must never lose the offer.
        if ($driver !== null) {
            // Geocode BEFORE the push, but time-boxed (~2.5s): the notification's
            // whole value is the distance + €/km, and the fleet's recurring streets
            // are cache-warm so they resolve instantly. A cold address that would eat
            // the 5-second accept window trips the deadline and is left to the async
            // GeocodeOffer job below — the push still goes out, just without metrics.
            rescue(fn () => $this->geocoder->enrichForNotify($record), report: false);

            try {
                $sent = $this->notifier->notify($record);
                RidyLog::event('dispatch_offer.notified', [
                    'offer_id' => $record->id,
                    'driver_id' => $driver->id,
                    'devices' => $sent,
                ]);
            } catch (Throwable $e) {
                RidyLog::event('dispatch_offer.notify_failed', ['offer_id' => $record->id, 'error' => $e->getMessage()]);
            }

            // Geocode off the hot path so a cold-cache address never blocks the
            // ingest batch; the 5-min backfill sweep is the safety net.
            GeocodeOffer::dispatch($record->id);
        }

        $status = $driver !== null ? 'routed' : 'unlinked_driver';

        // Test aid: every ingested offer with its full detail + routing result.
        RidyLog::event('dispatch_offer.ingested', [
            'status' => $status,
            'offer_id' => $record->id,
            'driver_id' => $driver?->id,
            'driver_uuid' => $driverUuid,
            'offer' => $offer,
        ]);

        return [
            'status' => $status,
            'offer_id' => $record->id,
            'driver_id' => $driver?->id,
        ];
    }

    private function millisToDate(mixed $millis): ?CarbonImmutable
    {
        if (! is_numeric($millis)) {
            return null;
        }

        return CarbonImmutable::createFromTimestampMs((int) $millis);
    }
}
