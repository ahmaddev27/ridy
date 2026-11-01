<?php

namespace App\Domain\Dispatch\Inbound;

use Illuminate\Support\Facades\Cache;

/**
 * A given Message-ID is processed at most once. Only the sha256 of the Message-ID is kept
 * (never the message or the code), for longer than a login can last.
 */
class ReplayGuard
{
    private const TTL_SECONDS = 600;

    /** True the first time this Message-ID is seen, false for every repeat (atomic). */
    public function first(string $messageId): bool
    {
        return Cache::add('uber_login:msg:'.hash('sha256', $messageId), 1, self::TTL_SECONDS);
    }
}
