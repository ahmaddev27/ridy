<?php

namespace App\Domain\Dispatch;

/**
 * What we ask Uber to do with an offer on the dispatch panel.
 *
 * REJECT is the only action anything creates. ACCEPT exists because Uber's panel
 * exposes the mirror-image mutation (AcceptOffers, byte-identical in shape) and
 * the owner asked that it be kept — so the daemon's executor and this table need
 * no change if it is ever opened up.
 *
 * ACCEPT is deliberately unreachable: no route creates it, no UI offers it, and
 * {@see DispatchActionService} refuses it outright. Accepting a ride on a driver's
 * behalf is a different product decision from declining one, and the project's
 * standing rule is that acceptance stays INFERRED from the driver's own Uber
 * status. Do not wire it up without an explicit decision to change that.
 */
enum DispatchCommandAction: string
{
    case Reject = 'reject';
    case Accept = 'accept';

    /** The Uber GraphQL operation this action maps to. */
    public function operationName(): string
    {
        return match ($this) {
            self::Reject => 'RejectOffers',
            self::Accept => 'AcceptOffers',
        };
    }
}
