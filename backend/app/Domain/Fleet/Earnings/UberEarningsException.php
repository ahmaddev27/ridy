<?php

namespace App\Domain\Fleet\Earnings;

use RuntimeException;

/** The pull could not be completed; `reason` is stable, the message is for logs. */
final class UberEarningsException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message = '', public readonly int $status = 502)
    {
        parent::__construct($message !== '' ? $message : $reason);
    }
}
