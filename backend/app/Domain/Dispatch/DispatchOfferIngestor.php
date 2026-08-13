<?php

namespace App\Domain\Dispatch;

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
    ) {}

    /**
     * @param  array<string, mixed>  $offer  one entry from offers[]
     * @return array{status: string, offer_id?: int, driver_id?: int|null}
     */
    public function ingest(int $tenantId, array $offer, ?int $seq = null): array
    {
        $this->context->set($tenantId);

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
                'pickup_address' => Arr::get($offer, 'pickupAddress'),
                'dropoff_address' => Arr::get($offer, 'dropoffAddress'),
                'fare_formatted' => Arr::get($offer, 'formattedUFP'),
                'fare_amount' => DriverStatsService::parseFare(Arr::get($offer, 'formattedUFP')) ?: null,
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

        // Notify the driver's devices as soon as the offer is routed. The 5-second
        // accept window makes this notification time-sensitive — but a push failure
        // must never lose the offer.
        if ($driver !== null) {
            try {
                $this->notifier->notify($record);
            } catch (Throwable $e) {
                RidyLog::event('dispatch_offer.notify_failed', ['offer_id' => $record->id, 'error' => $e->getMessage()]);
            }
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
