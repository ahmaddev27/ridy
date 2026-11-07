<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Tenancy\Models\Tenant;
use Throwable;

/**
 * Evaluates a driver's auto-decline ("Early decline") rules against an incoming
 * offer — docs/25. Returns the key of the FIRST rule that fires, or null.
 *
 * Deliberately evaluates only data that is ALREADY to hand (no live geocode, no
 * network call): the engine runs on the ingest hot path inside a ~3–4 s budget,
 * so a rule whose inputs are not instantly available is skipped for this offer
 * rather than delaying the decline. Live: the fare rule, the €/km floor (combinable
 * by AND/OR) and `reject_cities` (decided from the address's authoritative PLZ via
 * {@see CityMatcher} — table lookups only, never a geocode). The distance rules
 * (cache geocode + the driver's Fleet-Hub position) land later.
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
        if ($tenant === null || ! $tenant->autoDeclineFeatureEnabled() || ! $driver->autoDeclineActive()) {
            return null;
        }

        $rules = $driver->autoDeclineRules();

        $priceReason = $this->priceReason($offer, $rules['min_fare'] ?? null, $rules['min_price_per_km'] ?? null);
        if ($priceReason !== null) {
            return $priceReason;
        }

        return $this->pickupOrDropoffInRejectedCity($offer, $rules['reject_cities'] ?? null) ? 'reject_cities' : null;
    }

    /**
     * Reject when either end of the ride is in a city the driver blocked. Only an end
     * whose city is TRUSTED (see {@see CityMatcher::trustedCity()}) can block; the
     * match is exact on the normalised name, never a substring. Any fault or doubt
     * means "no" — an engine error must never change routing.
     *
     * @param  array<string, mixed>|null  $rule
     */
    private function pickupOrDropoffInRejectedCity(DispatchOffer $offer, ?array $rule): bool
    {
        if (($rule['enabled'] ?? false) !== true || ! is_array($rule['cities'] ?? null)) {
            return false;
        }

        try {
            $blocked = [];
            foreach ($rule['cities'] as $city) {
                $key = is_string($city) ? CityMatcher::key($city) : '';
                if ($key !== '') {
                    $blocked[$key] = true;
                }
            }

            foreach ([$offer->pickup_address, $offer->dropoff_address] as $address) {
                $city = $blocked === [] ? null : CityMatcher::trustedCity($address);
                if ($city !== null && isset($blocked[CityMatcher::key($city)])) {
                    return true;
                }
            }
        } catch (Throwable $e) {
            report($e);
        }

        return false;
    }

    /**
     * The execution-time gate: whether the company and the driver STILL permit an
     * automatic decline, judged on a FRESH read of both rows (never a model loaded
     * earlier, never a cache). Called at the claim step, the last moment before the
     * daemon is handed the command, so an admin revoke (`admin_enabled = false`) or
     * a company kill switch that landed after the command was queued still wins.
     */
    public function stillPermitted(int $tenantId, ?int $driverId): bool
    {
        if ($driverId === null) {
            return false;
        }

        $tenant = Tenant::withoutGlobalScopes()->find($tenantId);
        $driver = Driver::withoutGlobalScopes()->find($driverId);

        return $tenant !== null
            && $driver !== null
            && $tenant->autoDeclineFeatureEnabled()
            && $driver->autoDeclineActive();
    }

    /**
     * The two price criteria, combined by the driver's chosen mode. A criterion that
     * is not configured (off / no positive value) is absent: with none configured we
     * never decline, with exactly one only that one counts (the mode is moot).
     *
     *   and: decline when NOT (passFare && passPerKm)
     *   or : decline when NOT (passFare || passPerKm)
     *
     * Returns the reason to stamp: `min_fare` when the fare check failed, else
     * `min_price_per_km`.
     *
     * @param  array<string, mixed>|null  $fareRule
     * @param  array<string, mixed>|null  $perKmRule
     */
    private function priceReason(DispatchOffer $offer, ?array $fareRule, ?array $perKmRule): ?string
    {
        $fareFloorE2 = $this->floorE2($fareRule);
        $perKmFloorE2 = $this->floorE2($perKmRule);
        $passFare = $fareFloorE2 === null || $this->fareMeets($offer, $fareFloorE2);
        $passPerKm = $perKmFloorE2 === null || $this->perKmMeets($offer, $perKmFloorE2);

        $decline = match (true) {
            $fareFloorE2 === null && $perKmFloorE2 === null => false,
            $fareFloorE2 === null => ! $passPerKm,
            $perKmFloorE2 === null => ! $passFare,
            ($perKmRule['mode'] ?? 'and') === 'or' => ! ($passFare || $passPerKm),
            default => ! ($passFare && $passPerKm),
        };

        if (! $decline) {
            return null;
        }

        return $passFare ? 'min_price_per_km' : 'min_fare';
    }

    /**
     * The configured floor in integer cents, or null when the rule is off/unset.
     *
     * @param  array<string, mixed>|null  $rule
     */
    private function floorE2(?array $rule): ?int
    {
        $floorE2 = (int) ($rule['value_e2'] ?? 0);

        return ($rule['enabled'] ?? false) === true && $floorE2 > 0 ? $floorE2 : null;
    }

    /** Money is compared in integer cents; a missing fare is unknown and passes. */
    private function fareMeets(DispatchOffer $offer, int $floorE2): bool
    {
        if ($offer->fare_amount === null) {
            return true;
        }

        return (int) round(((float) $offer->fare_amount) * 100) >= $floorE2;
    }

    /**
     * Fare / road km (the offer's stored distance — the same value feeding the €/km
     * badge) against the floor, in cents per km. Unknown fare or distance passes.
     */
    private function perKmMeets(DispatchOffer $offer, int $floorE2): bool
    {
        $km = $offer->distance_m ? $offer->distance_m / 1000 : 0.0;
        if ($offer->fare_amount === null || $km <= 0) {
            return true;
        }

        return ((float) $offer->fare_amount) * 100 / $km >= $floorE2;
    }
}
