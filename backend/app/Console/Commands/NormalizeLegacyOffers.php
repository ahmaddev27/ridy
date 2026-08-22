<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\AddressNormalizer;
use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\DriverStatsService;
use Illuminate\Console\Command;

/**
 * Retro-fixes offers ingested before normalization existed — rows whose fare
 * carries Eastern (Arabic/Persian) digits and whose addresses hold a localized
 * (non-Latin) script.
 *
 * Two independent passes:
 *  1. Text  — cheap, no network: Latinize the fare, recompute fare_amount, and
 *     re-clean both addresses. Runs over every row.
 *  2. Regeocode (opt-in) — reset the geo state of rows whose address is still
 *     non-Latin after cleaning (a fully foreign street name only a geocode can
 *     render in German), so the throttled offers:backfill-geo sweep Germanizes
 *     them over time. Enabled with --regeocode.
 */
class NormalizeLegacyOffers extends Command
{
    protected $signature = 'offers:normalize-legacy {--chunk=500} {--regeocode : Also re-queue foreign-script addresses for German re-geocoding}';

    protected $description = 'Latinize fare digits and clean addresses on legacy offers; optionally re-queue foreign addresses for German re-geocoding.';

    public function handle(): int
    {
        $textFixed = 0;
        $requeued = 0;
        $regeocode = (bool) $this->option('regeocode');

        DispatchOffer::withoutGlobalScopes()
            ->orderBy('id')
            ->chunkById((int) $this->option('chunk'), function ($offers) use (&$textFixed, &$requeued, $regeocode) {
                foreach ($offers as $offer) {
                    $textFixed += $this->normalizeText($offer);

                    if ($regeocode && $this->stillForeign($offer)) {
                        $offer->geo_synced_at = null;
                        $offer->geo_attempts = 0;
                        $offer->save();
                        $requeued++;
                    }
                }
            });

        $this->info("Text-normalized {$textFixed} offer(s).");
        if ($regeocode) {
            $this->info("Re-queued {$requeued} foreign-script offer(s) for German re-geocoding (run offers:backfill-geo to process).");
        }

        return self::SUCCESS;
    }

    /** Latinize fare + re-clean addresses in place; returns 1 if anything changed. */
    private function normalizeText(DispatchOffer $offer): int
    {
        $fare = AddressNormalizer::latinizeDigits($offer->fare_formatted);
        $pickup = AddressNormalizer::clean($offer->pickup_address);
        $dropoff = AddressNormalizer::clean($offer->dropoff_address);

        $changed = false;

        if ($fare !== $offer->fare_formatted) {
            $offer->fare_formatted = $fare;
            $offer->fare_amount = DriverStatsService::parseFare($fare) ?: null;
            $changed = true;
        }
        if ($pickup !== $offer->pickup_address) {
            $offer->pickup_address = $pickup;
            $changed = true;
        }
        if ($dropoff !== $offer->dropoff_address) {
            $offer->dropoff_address = $dropoff;
            $changed = true;
        }

        if ($changed) {
            $offer->save();
        }

        return $changed ? 1 : 0;
    }

    /** An address is still foreign if cleaning couldn't strip its non-Latin script. */
    private function stillForeign(DispatchOffer $offer): bool
    {
        return AddressNormalizer::hasNonLatinLetters($offer->pickup_address)
            || AddressNormalizer::hasNonLatinLetters($offer->dropoff_address);
    }
}
