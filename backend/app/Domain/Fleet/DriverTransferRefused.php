<?php

namespace App\Domain\Fleet;

use DomainException;

/** A manual account transfer broke an invariant; $reason is a stable DriverAccountTransferService::REFUSAL_* code. */
class DriverTransferRefused extends DomainException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("Driver account transfer refused: {$reason}");
    }
}
