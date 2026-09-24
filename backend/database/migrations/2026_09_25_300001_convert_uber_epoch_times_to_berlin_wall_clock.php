<?php

use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Uber's epoch-millisecond times were stored as UTC wall-clock time (Carbon's
 * createFromTimestampMs() is UTC and Eloquent doesn't convert zones) while every
 * other column holds Europe/Berlin wall-clock time — 1-2 h behind. The code now
 * converts through App\Support\EpochTime; this shifts the rows written before.
 *
 * Idempotent and safe on a live table:
 *  - dispatch_offers: only rows whose requested_at / offer_generated_at sits
 *    ≥45 min BEFORE received_at are converted. Uber stamps those seconds before we
 *    receive the offer, so a converted (or newly written) row never matches again,
 *    even if this runs after the new code already wrote rows. Chunked by id so no
 *    statement locks the whole table.
 *  - driver_metrics (small): converted row by row; if the Berlin-time key already
 *    exists (a capture written by the new code), the stale UTC row is dropped
 *    instead of colliding on unique(driver_id, period_start, period_end).
 *  - drivers.location_updated_at is left alone: every status poll rewrites it.
 */
return new class extends Migration
{
    private const CHUNK = 5000;

    public function up(): void
    {
        $this->convertOffers();
        $this->convertMetrics();
    }

    public function down(): void
    {
        // Data correction — nothing to undo (the old values were wrong).
    }

    private function convertOffers(): void
    {
        $maxId = (int) DB::table('dispatch_offers')->max('id');

        foreach (['requested_at', 'offer_generated_at'] as $column) {
            for ($from = 0; $from <= $maxId; $from += self::CHUNK) {
                DB::table('dispatch_offers')
                    ->whereBetween('id', [$from, $from + self::CHUNK - 1])
                    ->whereNotNull($column)
                    ->whereNotNull('received_at')
                    ->whereRaw($this->olderThanReceivedBy($column, 45))
                    ->update([$column => DB::raw($this->berlinFromUtc($column))]);
            }
        }
    }

    private function convertMetrics(): void
    {
        DB::table('driver_metrics')->orderBy('id')->chunkById(500, function ($rows) {
            foreach ($rows as $row) {
                $start = $this->toBerlin($row->period_start);
                $end = $this->toBerlin($row->period_end);

                $clash = DB::table('driver_metrics')
                    ->where('driver_id', $row->driver_id)
                    ->where('period_start', $start)
                    ->where('period_end', $end)
                    ->where('id', '!=', $row->id)
                    ->exists();

                if ($clash) {
                    DB::table('driver_metrics')->where('id', $row->id)->delete();
                } else {
                    DB::table('driver_metrics')->where('id', $row->id)->update(['period_start' => $start, 'period_end' => $end]);
                }
            }
        });
    }

    private function toBerlin(?string $utc): ?string
    {
        return $utc === null ? null : CarbonImmutable::parse($utc, 'UTC')->setTimezone('Europe/Berlin')->format('Y-m-d H:i:s');
    }

    /** SQL: the column is at least $minutes before received_at (i.e. still UTC). */
    private function olderThanReceivedBy(string $column, int $minutes): string
    {
        return DB::connection()->getDriverName() === 'sqlite'
            ? "{$column} < datetime(received_at, '-{$minutes} minutes')"
            : "{$column} < received_at - INTERVAL {$minutes} MINUTE";
    }

    /**
     * SQL: the UTC wall-clock column as Europe/Berlin wall-clock — +2 h inside a
     * summer-time window (last Sunday of March 01:00 UTC → last Sunday of October
     * 01:00 UTC), +1 h otherwise. Windows are literal UTC instants, so no MySQL
     * time-zone tables are needed.
     */
    private function berlinFromUtc(string $column): string
    {
        $summer = [];
        for ($year = 2020; $year <= 2040; $year++) {
            $start = CarbonImmutable::parse("last sunday of march {$year} 01:00", 'UTC')->format('Y-m-d H:i:s');
            $end = CarbonImmutable::parse("last sunday of october {$year} 01:00", 'UTC')->format('Y-m-d H:i:s');
            $summer[] = "({$column} >= '{$start}' AND {$column} < '{$end}')";
        }
        $isSummer = implode(' OR ', $summer);

        return DB::connection()->getDriverName() === 'sqlite'
            ? "CASE WHEN {$isSummer} THEN datetime({$column}, '+2 hours') ELSE datetime({$column}, '+1 hours') END"
            : "CASE WHEN {$isSummer} THEN {$column} + INTERVAL 2 HOUR ELSE {$column} + INTERVAL 1 HOUR END";
    }
};
