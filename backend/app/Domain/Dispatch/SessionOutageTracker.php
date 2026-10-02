<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\FleetSessionOutage;
use App\Domain\Dispatch\Models\UberFleetSession;
use Carbon\CarbonImmutable;

/**
 * Measures Uber session outages: one open row per session from the moment Uber
 * rejects it until the daemon's offer stream delivers again. "Active" alone is
 * not recovery — a capture of already-dead cookies flips the session active and
 * Uber rejects it again seconds later — so only a live stream closes an outage.
 */
class SessionOutageTracker
{
    public function open(UberFleetSession $session, string $cause): void
    {
        if ($this->current($session) !== null) {
            return;
        }

        FleetSessionOutage::create([
            'tenant_id' => $session->tenant_id,
            'uber_fleet_session_id' => $session->id,
            'started_at' => CarbonImmutable::now(),
            'cause' => $cause,
        ]);
    }

    /** A new cookie jar arrived while the session is down; the latest attempt wins. */
    public function relinkAttempted(UberFleetSession $session, string $via): void
    {
        $outage = $this->current($session);
        if ($outage === null) {
            return;
        }

        $outage->forceFill([
            'recovered_via' => $via,
            'relink_attempts' => $outage->relink_attempts + 1,
        ])->save();
    }

    /** The stream delivered again: close and return the open outage, if any. */
    public function close(UberFleetSession $session): ?FleetSessionOutage
    {
        $outage = $this->current($session);
        $outage?->forceFill(['ended_at' => CarbonImmutable::now()])->save();

        return $outage;
    }

    public function isOpen(UberFleetSession $session): bool
    {
        return $this->current($session) !== null;
    }

    /**
     * A company's outages over the last $days, newest first, with totals.
     *
     * @return array{outages: list<array<string, mixed>>, count: int, total_seconds: int, open: bool}
     */
    public function summary(int $tenantId, int $days = 30, int $limit = 50): array
    {
        $now = CarbonImmutable::now();
        $outages = FleetSessionOutage::where('tenant_id', $tenantId)
            ->where('started_at', '>=', $now->subDays($days))
            ->orderByDesc('started_at')
            ->limit($limit)
            ->get();

        return [
            'outages' => $outages->map(fn (FleetSessionOutage $o) => [
                'started_at' => $o->started_at->toIso8601String(),
                'ended_at' => $o->ended_at?->toIso8601String(),
                'duration_seconds' => $o->durationSeconds($now),
                'cause' => $o->cause,
                'recovered_via' => $o->recovered_via,
                'relink_attempts' => $o->relink_attempts,
            ])->values()->all(),
            'count' => $outages->count(),
            'total_seconds' => (int) $outages->sum(fn (FleetSessionOutage $o) => $o->durationSeconds($now)),
            'open' => $outages->contains(fn (FleetSessionOutage $o) => $o->ended_at === null),
        ];
    }

    private function current(UberFleetSession $session): ?FleetSessionOutage
    {
        return FleetSessionOutage::where('uber_fleet_session_id', $session->id)
            ->whereNull('ended_at')
            ->latest('started_at')
            ->first();
    }
}
