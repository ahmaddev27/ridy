<?php

namespace App\Domain\Dispatch;

/**
 * The lifecycle of one dispatch action we asked Uber to apply to an offer.
 *
 *   QUEUED → CLAIMED → SUCCEEDED      Uber answered isSuccess: true
 *   QUEUED → CLAIMED → FAILED         Uber refused, or the call never landed
 *   QUEUED → EXPIRED                  no daemon claimed it before the window closed
 *   FAILED → QUEUED                   the driver asked again (attempts is bounded)
 *
 * SUCCEEDED is the only state that may move the offer itself to rejected: a
 * failed decline must leave the offer pending, or the dashboard would show a
 * decline Uber never accepted and the inferred-accept path would go incoherent.
 */
enum DispatchCommandStatus: string
{
    case Queued = 'queued';
    case Claimed = 'claimed';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
    case Expired = 'expired';

    /** Whether the command is finished — nothing more will happen to it. */
    public function isFinal(): bool
    {
        return in_array($this, [self::Succeeded, self::Expired], true);
    }

    /** Whether a fresh request may re-queue this command rather than be ignored. */
    public function isRetryable(): bool
    {
        return $this === self::Failed;
    }
}
