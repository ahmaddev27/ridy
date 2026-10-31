<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;

/**
 * Evaluates a driver's auto-decline ("Early decline") rules against an incoming
 * offer — docs/25. Returns the key of the FIRST rule that fires, or null.
 *
 * Deliberately evaluates only data that is ALREADY to hand (no live geocode, no
 * network call): the engine runs on the ingest hot path inside a ~3–4 s budget,
 * so a rule whose inputs are not instantly available is skipped for this offer
 * rather than delaying the decline. Phase 1 ships the fare rule only; the city and
 * distance rules (cache geocode + the driver's Fleet-Hub position) land later.
 *
 * This NEVER decides to accept and never acts on its own judgement — it only reads
 * the driver's own standing rules. See AGENTS.md golden rule #1.
 */
class DispatchAutoDecline
{
    /**
     * The rule key that fires for this offer, or null when none do — including when
     * the company feature is off or the driver has not opted in. The order below is
     * the rule precedence (first match wins; the reason we stamp).
     */
    public function match(DispatchOffer $offer, Driver $driver): ?string
    {
        $tenant = $offer->tenant;
        if ($tenant === null || ! $tenant->autoDeclineFeatureEnabled() || ! $driver->autoDeclineEnabled()) {
            return null;
        }

        $rules = $driver->autoDeclineRules();

        if ($this->fareBelowFloor($offer, $rules['min_fare'] ?? null)) {
            return 'min_fare';
        }

        return null;
    }

    /**
     * Reject when the offer's fare is below the driver's floor. Money is compared in
     * integer cents, never as a float; a null/zero floor or an offer with no parsed
     * fare simply does not match (we never auto-decline on missing data).
     *
     * @param  array<string, mixed>|null  $rule
     */
    private function fareBelowFloor(DispatchOffer $offer, ?array $rule): bool
    {
        if (($rule['enabled'] ?? false) !== true) {
            return false;
        }

        $floorE2 = (int) ($rule['value_e2'] ?? 0);
        if ($floorE2 <= 0 || $offer->fare_amount === null) {
            return false;
        }

        return (int) round(((float) $offer->fare_amount) * 100) < $floorE2;
    }
}
