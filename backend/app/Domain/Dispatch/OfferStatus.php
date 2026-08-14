<?php

namespace App\Domain\Dispatch;

/**
 * The lifecycle of a dispatch offer, inferred from the driver's live status
 * (we observe Uber, we don't control the trip). Transitions are guarded so an
 * invalid or duplicate move is a no-op, which keeps ingestion idempotent.
 *
 *   PENDING → ACCEPTED → STARTED → COMPLETED
 *   PENDING → REJECTED            (accept window elapsed, never taken)
 *   ACCEPTED → CANCELED           (accepted, then dropped before the trip began)
 */
enum OfferStatus: string
{
    case Pending = 'pending';
    case Accepted = 'accepted';
    case Started = 'started';
    case Completed = 'completed';
    case Rejected = 'rejected';
    case Canceled = 'canceled';

    /** The only moves allowed out of each state. */
    public function canTransitionTo(self $to): bool
    {
        return in_array($to, $this->allowedNext(), true);
    }

    /** @return array<int, self> */
    private function allowedNext(): array
    {
        return match ($this) {
            self::Pending => [self::Accepted, self::Rejected],
            self::Accepted => [self::Started, self::Canceled],
            self::Started => [self::Completed],
            // A late-detected acceptance overturns a premature timeout rejection:
            // our accept window is short, but the driver's engagement can be seen
            // a poll or two later, after the expiry sweep already marked it rejected.
            self::Rejected => [self::Accepted],
            self::Completed, self::Canceled => [],
        };
    }

    /** Whether the offer was ever accepted (taken), regardless of its final state. */
    public function isTaken(): bool
    {
        return in_array($this, [self::Accepted, self::Started, self::Completed, self::Canceled], true);
    }
}
