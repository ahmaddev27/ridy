<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Jobs\GeocodeOffer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Tenancy\TenantContext;
use App\Support\EpochTime;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Turns a single raw offer from the Uber RAMEN stream into a stored, driver-routed
 * DispatchOffer. Idempotent on offer_uuid — the stream repeats offers, so a repeat
 * must never create a duplicate row or fire a second notification.
 */
class DispatchOfferIngestor
{
    /**
     * Pre-push geocode budget for ONE ingest request. Callers share a single
     * deadline across the whole batch ({@see self::batchDeadline()}), so N offers in
     * one RAMEN message can never stack N separate budgets and push the later
     * drivers out of Uber's ~5-second accept window.
     */
    public const GEOCODE_BUDGET_SECONDS = 2.5;

    public function __construct(
        private TenantContext $context,
        private DispatchNotifier $notifier,
        private OfferLifecycle $lifecycle,
        private TripGeocoder $geocoder,
    ) {}

    /** A geocode deadline (microtime) to share across every offer of one ingest request. */
    public static function batchDeadline(): float
    {
        return microtime(true) + self::GEOCODE_BUDGET_SECONDS;
    }

    /**
     * @param  array<string, mixed>  $offer  one entry from offers[]
     * @param  float|null  $geocodeDeadline  shared batch deadline (microtime); null = a fresh budget
     * @return array{status: string, offer_id?: int, driver_id?: int|null}
     */
    public function ingest(int $tenantId, array $offer, ?int $seq = null, ?float $geocodeDeadline = null): array
    {
        // Save and RESTORE rather than clear. Clearing is right for a queue worker,
        // but the extension path calls this from inside an authenticated dashboard
        // request where ResolveTenant established the context — so after the first
        // offer of a batch the request's tenant context was gone, leaving the global
        // scope silently absent for anything running later in that request. Worker
        // isolation is guaranteed separately by the Queue::looping hook in
        // AppServiceProvider::boot().
        $previous = $this->context->get();
        $this->context->set($tenantId);

        try {
            return $this->route($tenantId, $offer, $seq, $geocodeDeadline);
        } finally {
            $this->context->set($previous);
        }
    }

    /**
     * @param  array<string, mixed>  $offer
     * @return array{status: string, offer_id?: int, driver_id?: int|null}
     */
    private function route(int $tenantId, array $offer, ?int $seq, ?float $geocodeDeadline): array
    {
        $offerUuid = $this->scalar($offer, 'offerUUID');

        if ($offerUuid === '') {
            return ['status' => 'skipped_no_uuid'];
        }

        $existing = DispatchOffer::where('offer_uuid', $offerUuid)->first();

        if ($existing !== null) {
            return ['status' => 'duplicate', 'offer_id' => $existing->id, 'driver_id' => $existing->driver_id];
        }

        $driverUuid = $this->scalar($offer, 'driverInfo.driverUUID');
        $driver = $driverUuid !== ''
            ? Driver::where('uber_driver_uuid', $driverUuid)->first()
            : null;

        $fare = AddressNormalizer::latinizeDigits($this->nullableScalar($offer, 'formattedUFP'));
        $acceptWindow = Arr::get($offer, 'acceptWindowInSeconds');

        try {
            $record = DispatchOffer::create([
                'tenant_id' => $tenantId,
                'driver_uuid' => $driverUuid,
                'driver_id' => $driver?->id,
                'offer_uuid' => $offerUuid,
                'real_offer_uuid' => $this->nullableScalar($offer, 'realOfferUUID'),
                'partner_uuid' => $this->nullableScalar($offer, 'partnerUUID'),
                'seq' => $seq,
                'rider_first_name' => $this->nullableScalar($offer, 'riderFirstName'),
                'driver_first_name' => $this->nullableScalar($offer, 'driverInfo.firstName'),
                'driver_last_name' => $this->nullableScalar($offer, 'driverInfo.lastName'),
                'pickup_address' => AddressFormatter::tidy($this->nullableScalar($offer, 'pickupAddress')),
                'dropoff_address' => AddressFormatter::tidy($this->nullableScalar($offer, 'dropoffAddress')),
                // Latinize Uber's localized fare so the number parses and displays
                // in Latin digits regardless of the captured session's language.
                'fare_formatted' => $fare,
                'fare_amount' => DriverStatsService::parseFare($fare) ?: null,
                'accept_window_seconds' => is_numeric($acceptWindow) ? (int) $acceptWindow : null,
                // Uber's epoch-ms times, stored as Berlin wall-clock like every other column.
                'requested_at' => EpochTime::fromMs(Arr::get($offer, 'requestAt')),
                'offer_generated_at' => EpochTime::fromMs(Arr::get($offer, 'offerGeneratedAtMs')),
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

        // Notify the driver FIRST: the ~5-second accept window makes the push the
        // time-critical step, so nothing optional (the supersede UPDATE, owner
        // fan-out, queue writes) may run ahead of it or be able to stop it.
        if ($driver !== null) {
            $this->notifyDriver($record, $geocodeDeadline);
        }

        // A driver holds one live offer at a time — Uber sends the next only once
        // the previous is gone. So this new offer supersedes (→ rejected) any older
        // still-pending offer of theirs, whether idle or on a trip. It runs AFTER the
        // push (it doesn't change what the push carries) and best-effort: the bulk
        // UPDATE contends with status transitions and the sweeps on the same rows,
        // and a lost race must never fail the batch — expirePending (or the next
        // offer) rejects the stale row a moment later.
        if ($driverUuid !== '') {
            try {
                LockRetry::run(fn () => $this->lifecycle->supersedePendingFor($tenantId, $driverUuid, $record->id), attempts: 2);
            } catch (Throwable $e) {
                Log::warning('dispatch_offer.supersede_failed', ['offer_id' => $record->id, 'error' => $e->getMessage()]);
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

    /**
     * Geocode (time-boxed) then push. A push failure must never lose the offer.
     *
     * The geocode runs BEFORE the push, bounded by the batch deadline: the
     * notification's whole value is the distance + €/km, and the fleet's recurring
     * streets are cache-warm so they resolve instantly. A cold address that would
     * eat the accept window trips the deadline and is left to the async GeocodeOffer
     * job — the push still goes out, just without metrics.
     */
    private function notifyDriver(DispatchOffer $record, ?float $geocodeDeadline): void
    {
        rescue(fn () => $this->geocoder->enrichForNotify($record, $geocodeDeadline), report: false);

        try {
            $sent = $this->notifier->notify($record);
            RidyLog::event('dispatch_offer.notified', [
                'offer_id' => $record->id,
                'driver_id' => $record->driver_id,
                'devices' => $sent,
                // Ingest → push latency: surfaces any queueing ahead of the push.
                'latency_ms' => (int) round((microtime(true) - (float) $record->received_at->format('U.u')) * 1000),
            ]);
        } catch (Throwable $e) {
            // A failed driver push is a core-path failure, so it must reach Sentry and
            // the log (RidyLog is a no-op in production).
            report($e);
            Log::error('dispatch_offer.notify_failed', [
                'offer_id' => $record->id,
                'tenant_id' => $record->tenant_id,
                'error' => $e->getMessage(),
            ]);
        }

        // Finish the geocode off the hot path — only when the pre-push run didn't,
        // so a cache-warm offer never queues a job that immediately no-ops.
        if ($record->geo_synced_at === null) {
            // A statement closure (not an arrow fn) so the PendingDispatch is
            // destructed — i.e. actually queued — INSIDE rescue's try.
            rescue(function () use ($record): void {
                GeocodeOffer::dispatch($record->id);
            });
        }
    }

    /** A payload field as a string; '' when absent or not a scalar (never "Array"). */
    private function scalar(array $offer, string $key): string
    {
        $value = Arr::get($offer, $key);

        return is_scalar($value) ? (string) $value : '';
    }

    /** A payload field as a string; null when absent, empty or not a scalar. */
    private function nullableScalar(array $offer, string $key): ?string
    {
        $value = $this->scalar($offer, $key);

        return $value !== '' ? $value : null;
    }
}
