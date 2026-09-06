<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\AddressNormalizer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\TripGeocoder;
use Illuminate\Console\Command;

/**
 * Upgrades offers whose stored display address is a rider-localized non-Latin
 * string or a bare "<PLZ> City" (no street) into a FULL German address, by
 * reverse-geocoding the real coordinates we already stored for the trip.
 *
 * The live path (applyFromWaypoints) already does this, but an offer whose
 * reverse failed transiently at sync time is locked (geo_source='uber') and
 * keeps the partial address. This backfills those from the coordinates on the
 * row — run once on prod after deploying the address fix.
 */
class BackfillAddresses extends Command
{
    protected $signature = 'offers:backfill-addresses {--limit=1000}';

    protected $description = 'Re-reverse stored coordinates into full German addresses for offers stuck on a partial/non-Latin label.';

    public function handle(TripGeocoder $geo): int
    {
        $offers = DispatchOffer::withoutGlobalScopes()
            ->whereNotNull('dropoff_lat')
            ->latest('received_at')
            ->limit((int) $this->option('limit'))
            ->get();

        $fixed = 0;
        foreach ($offers as $offer) {
            $changed = false;

            if ($offer->pickup_lat !== null && $offer->pickup_lng !== null && $this->needsUpgrade($offer->pickup_display)) {
                $label = $geo->reverse((float) $offer->pickup_lat, (float) $offer->pickup_lng);
                if ($this->usable($label)) {
                    $offer->pickup_display = $label;
                    $changed = true;
                }
            }

            if ($offer->dropoff_lat !== null && $offer->dropoff_lng !== null && $this->needsUpgrade($offer->dropoff_display)) {
                $label = $geo->reverse((float) $offer->dropoff_lat, (float) $offer->dropoff_lng);
                if ($this->usable($label)) {
                    $offer->dropoff_display = $label;
                    $changed = true;
                }
            }

            // Keep the itinerary's first/last stop labels in sync with the endpoints.
            if ($changed && is_array($offer->stops) && count($offer->stops) >= 2) {
                $stops = $offer->stops;
                $last = count($stops) - 1;
                if (isset($stops[0]['address']) && $offer->pickup_display) {
                    $stops[0]['address'] = $offer->pickup_display;
                }
                if (isset($stops[$last]['address']) && $offer->dropoff_display) {
                    $stops[$last]['address'] = $offer->dropoff_display;
                }
                $offer->stops = $stops;
            }

            if ($changed) {
                $offer->save();
                $fixed++;
            }
        }

        $this->info("Backfilled {$fixed} of {$offers->count()} offer(s).");

        return self::SUCCESS;
    }

    /** A display that needs a real street: empty, non-Latin, or bare "PLZ City". */
    private function needsUpgrade(?string $display): bool
    {
        $d = trim((string) $display);
        if ($d === '' || AddressNormalizer::hasNonLatinLetters($d)) {
            return true;
        }

        // Starts with the 5-digit postcode ⇒ no street precedes it (e.g. "42781 Haan").
        return preg_match('/^\s*\d{5}\b/', $d) === 1;
    }

    /** A reverse result worth storing: present and Latin (German). */
    private function usable(?string $label): bool
    {
        return $label !== null && $label !== '' && ! AddressNormalizer::hasNonLatinLetters($label);
    }
}
