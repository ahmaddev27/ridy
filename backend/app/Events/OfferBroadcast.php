<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
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
class OfferBroadcast implements ShouldBroadcast
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

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['offer_id' => $this->offerId, 'reason' => $this->reason];
    }
}
