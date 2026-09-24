<?php

namespace App\Domain\Tenancy;

use App\Domain\Dispatch\Models\UberFleetSession;
use Illuminate\Support\Collection;

/**
 * The newest Uber fleet session per tenant, for admin overviews.
 *
 * Selects only status/timestamp columns: the admin pages used to load every
 * session row including its multi-KB encrypted cookie jars just to read a
 * status. `unique()` after the newest-first sort keeps the newest row (keyBy
 * alone would keep the LAST, i.e. the oldest); the id tie-break makes it
 * deterministic.
 */
final class LatestFleetSessions
{
    private const COLUMNS = ['id', 'tenant_id', 'status', 'last_event_at', 'expires_at', 'updated_at'];

    /** @return Collection<int, UberFleetSession> keyed by tenant_id */
    public static function perTenant(): Collection
    {
        return UberFleetSession::withoutGlobalScopes()
            ->select(self::COLUMNS)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->get()
            ->unique('tenant_id')
            ->keyBy('tenant_id');
    }
}
