<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A real-time nudge to one driver's app that an offer changed — a fresh offer
 * arrived or an existing one's status moved. Kept intentionally light: it carries
 * only the offer id + reason, and the app refetches the list on receipt, so the
 * WebSocket path reuses the exact same rendering as a poll/pull. Broadcast on the
 * driver's private channel, authorised in routes/channels.php.
 */
class OfferBroadcast implements ShouldBroadcast
{
    use Dispatchable;
    use InteractsWithSockets;
    use SerializesModels;

    public function __construct(
        public readonly int $driverId,
        public readonly int $offerId,
        public readonly string $reason = 'new', // new | status
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('driver.'.$this->driverId);
    }

    public function broadcastAs(): string
    {
        return 'offer.changed';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['offer_id' => $this->offerId, 'reason' => $this->reason];
    }
}
