<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A real-time nudge that the fleet's live driver positions/statuses changed — fired
 * once per status-ingest batch (the daemon posts every ~4–10s). The dashboard live
 * map refetches on receipt instead of polling, so drivers move in near-real-time.
 *
 * Broadcast on the company's private channel (tenant-isolated in routes/channels.php);
 * kept payload-free — the client refetches, reusing the exact same rendering as a poll.
 * Sent synchronously (ShouldBroadcastNow) off the ingest path so there's no queue lag.
 */
class DriversBroadcast implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(public readonly int $tenantId) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('company.'.$this->tenantId);
    }

    public function broadcastAs(): string
    {
        return 'drivers.changed';
    }
}
