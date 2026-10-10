<?php

namespace App\Events;

use App\Domain\Dispatch\AddressLatinizer;
use App\Domain\Dispatch\Models\DispatchOffer;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A real-time nudge that an offer changed — a fresh offer arrived or an existing
 * one's status moved. Kept intentionally light: it carries only the offer id +
 * reason, and every listener refetches on receipt, so the WebSocket path reuses
 * the exact same rendering as a poll/pull.
 *
 * Broadcast on two private channels (authorised in routes/channels.php):
 *   - `driver.{driverId}`  → the one driver's app (skipped for an unlinked offer).
 *   - `company.{tenantId}` → the fleet dashboard (every offer, linked or not),
 *     so a manager sees the feed live. Tenant isolation is enforced by the
 *     channel authorization: a user may only subscribe to their OWN company.
 */
class OfferBroadcast implements ShouldBroadcastNow
{
    use Dispatchable;
    use InteractsWithSockets;
    use SerializesModels;

    public function __construct(
        public readonly int $driverId,
        public readonly int $tenantId,
        public readonly int $offerId,
        public readonly string $reason = 'new', // new | status | multistop
    ) {}

    /** @return array<int, Channel> */
    public function broadcastOn(): array
    {
        $channels = [new PrivateChannel('company.'.$this->tenantId)];
        if ($this->driverId > 0) {
            $channels[] = new PrivateChannel('driver.'.$this->driverId);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'offer.changed';
    }

    /**
     * The payload. `offer_id` + `reason` are always present and unchanged, so every
     * existing listener keeps working by refetching exactly as before.
     *
     * A FRESH offer additionally carries the bare fields inline. The driver app's
     * decline pop-up has to be on screen inside Uber's ~5-second window, and a
     * refetch spends a mobile round trip of that window before it can draw
     * anything. These fields are what the pop-up renders — nothing derived, nothing
     * geocoded — so it can open on the socket frame alone. The full detail (road
     * distance, €/km, coordinates) still arrives by the refetch and by the later
     * `status` broadcast the geocode emits.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        $payload = ['offer_id' => $this->offerId, 'reason' => $this->reason];

        if ($this->reason !== 'new') {
            return $payload;
        }

        // Defensive: broadcastWith() runs inside the publish, which is best-effort
        // and must never throw — a wiped company or a dropped DB connection here
        // would otherwise take out the offer transition that is publishing.
        $offer = rescue(
            fn () => DispatchOffer::withoutGlobalScopes()->find($this->offerId),
            report: false,
        );

        if (! $offer instanceof DispatchOffer) {
            return $payload;
        }

        return $payload + [
            'offer_uuid' => (string) $offer->offer_uuid,
            'fare' => (string) ($offer->fare_formatted ?? ''),
            // Latinized like every other driver-facing address: Uber localizes this
            // text to the RIDER's language, and a driver is never shown a non-Latin
            // address (see AddressLatinizer).
            'pickup' => AddressLatinizer::toLatin($offer->pickup_display, $offer->pickup_address) ?? '',
            'dropoff' => AddressLatinizer::toLatin($offer->dropoff_display, $offer->dropoff_address) ?? '',
            'rider_name' => (string) ($offer->rider_first_name ?? ''),
            // The pop-up's countdown: Uber's own window, measured from Uber's own
            // clock where it sent one, so the clock on screen is not our latency.
            'accept_window' => $offer->accept_window_seconds,
            'offer_generated_at' => $offer->offer_generated_at?->toIso8601String(),
            'received_at' => $offer->received_at?->toIso8601String(),
        ];
    }
}
