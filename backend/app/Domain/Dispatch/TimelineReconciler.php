<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use Carbon\CarbonImmutable;

/**
 * Reconciles offer acceptance from Uber's own activity timeline (GetTimelineInfo).
 *
 * Acceptance is normally inferred from the live status poll, but a coarse/slow poll
 * (the browser extension's ~60s cadence) skips the brief idle→engaged edge, so a
 * busy driver's real acceptances end up wrongly marked "not taken". Uber's timeline
 * is a COMPLETE history — every assigned trip is recorded with its timestamp — so we
 * match each assignment to the driver's pending offer by time (the offer received
 * just before the assignment) and mark it accepted. The offer UUID is not carried on
 * the timeline (it's null), so time + driver is the correlation key.
 */
class TimelineReconciler
{
    public function __construct(private readonly OfferLifecycle $lifecycle) {}

    /** How far before an assignment to look for the matching offer. */
    private const LOOKBACK_MINUTES = 5;

    /**
     * @param  array<int, array<string, mixed>>  $events  GetTimelineInfo events (as flattened by the extension)
     * @return int number of offers newly attributed as accepted
     */
    public function reconcile(int $tenantId, string $driverUuid, array $events): int
    {
        $accepted = 0;
        foreach ($events as $event) {
            $assignedAtMs = $this->assignedAtMs(is_array($event) ? $event : []);
            if ($assignedAtMs === null) {
                continue;
            }
            $offer = $this->matchOffer($tenantId, $driverUuid, $assignedAtMs);
            if ($offer !== null && $this->lifecycle->accept($offer)) {
                $accepted++;
            }
        }

        return $accepted;
    }

    /**
     * The ms-epoch at which a trip was assigned (accepted), or null when the event
     * isn't an assignment. A DJ_ASSIGNED state change is the precise signal; a bare
     * event that already carries a jobuuid is a fallback.
     *
     * @param  array<string, mixed>  $event
     */
    private function assignedAtMs(array $event): ?int
    {
        foreach ($event['stateChange'] ?? [] as $change) {
            if (is_array($change) && ($change['type'] ?? null) === 'DJ_ASSIGNED' && isset($change['timestamp'])) {
                return (int) $change['timestamp'];
            }
        }

        $job = $event['jobuuid'] ?? null;
        if (is_string($job) && $job !== '' && isset($event['timestamp'])) {
            return (int) $event['timestamp'];
        }

        return null;
    }

    /**
     * The driver's not-yet-accepted offer that best matches an assignment time — the
     * most recent one received in the short window ending just after it. Already
     * -accepted offers are skipped, so re-running is idempotent.
     */
    private function matchOffer(int $tenantId, string $driverUuid, int $assignedAtMs): ?DispatchOffer
    {
        // Match the app timezone that received_at is stored in — createFromTimestampMs
        // is UTC by default, which would shift the window off by the tz offset.
        $at = CarbonImmutable::createFromTimestampMs($assignedAtMs)->setTimezone(config('app.timezone', 'UTC'));

        return DispatchOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('driver_uuid', $driverUuid)
            ->whereNull('accepted_at')
            ->whereBetween('received_at', [$at->subMinutes(self::LOOKBACK_MINUTES), $at->addSeconds(45)])
            ->orderByDesc('received_at') // the offer received just before the assignment
            ->first();
    }
}
