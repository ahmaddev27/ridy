<?php

namespace App\Domain\Dispatch;

use App\Support\EpochTime;
use App\Support\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * One-off correction of Uber epoch times stored as UTC wall-clock time by code
 * before {@see EpochTime} (1-2 h behind every other column, which holds
 * Europe/Berlin wall-clock time). Run by the 2026_09_25_300001 migration and, to
 * catch rows a rolled-back release wrote afterwards, by `dispatch:convert-epoch-times`.
 *
 * Idempotent and safe while old and new code both write during a deploy (the
 * backend is bind-mounted, so FPM serves the new code from `git reset`, BEFORE
 * migrate runs):
 *
 *  - dispatch_offers, rows with offer_generated_at: Uber stamps it seconds before
 *    we receive the offer, so it identifies the row by itself — ≥45 min before
 *    received_at means UTC (old code), anything closer is Berlin (new code or
 *    already converted). Both columns of such a row are converted in one UPDATE,
 *    after which it never matches again. Covers rows written at any time.
 *  - dispatch_offers, rows without it: only requested_at can tell, and a scheduled
 *    ride's requested_at is legitimately far before receipt, so the same test
 *    would shift a converted row again. These are converted only up to the id
 *    recorded on the first run (`offers_cutoff`), walking ids once with the
 *    progress (`offers_done`) committed together with each chunk.
 *  - driver_metrics (small): up to the id recorded on the first run, in ONE
 *    transaction (a crash rolls back; a re-run starts clean), then marked done.
 *    A row whose Berlin key already exists is a stale twin of a capture the new
 *    code wrote — it is dropped and the twin is left as-is. Rows the old code's
 *    fallback stamped Monday 00:00 (already Berlin — no Uber week starts at a
 *    UTC midnight) are skipped.
 *  - drivers.location_updated_at is left alone: every status poll rewrites it.
 */
class EpochTimeBackfill
{
    public const STATE_KEY = 'epoch_berlin_backfill';

    private const CHUNK = 5000;

    private const METRICS_CHUNK = 500;

    /** Minimum lag behind received_at that marks a value as still UTC. */
    private const UTC_LAG_MINUTES = 45;

    /** @return array{offers: int, metrics: int} rows converted (metrics: converted + dropped) */
    public function run(): array
    {
        $state = $this->state();

        return [
            'offers' => $this->convertOffers($state),
            'metrics' => $this->convertMetrics($state),
        ];
    }

    /** @param array{offers_cutoff: int, offers_done: int, metrics_cutoff: int, metrics_done: bool} $state */
    private function convertOffers(array &$state): int
    {
        $converted = 0;
        $from = $state['offers_done'] + 1;
        $maxId = (int) DB::table('dispatch_offers')->max('id');

        for (; $from <= $maxId; $from += self::CHUNK) {
            $to = $from + self::CHUNK - 1;

            DB::transaction(function () use ($from, $to, &$state, &$converted) {
                $converted += $this->offerChunk($from, $to)
                    ->whereNotNull('offer_generated_at')
                    ->whereRaw($this->utcLag('offer_generated_at'))
                    ->update($this->toBerlin(['requested_at', 'offer_generated_at']));

                if ($from <= $state['offers_cutoff']) {
                    $converted += $this->offerChunk($from, min($to, $state['offers_cutoff']))
                        ->whereNull('offer_generated_at')
                        ->whereNotNull('requested_at')
                        ->whereRaw($this->utcLag('requested_at'))
                        ->update($this->toBerlin(['requested_at']));
                }

                $state['offers_done'] = max($state['offers_done'], min($to, $state['offers_cutoff']));
                $this->saveState($state);
            });
        }

        return $converted;
    }

    /** @param array{offers_cutoff: int, offers_done: int, metrics_cutoff: int, metrics_done: bool} $state */
    private function convertMetrics(array &$state): int
    {
        if ($state['metrics_done']) {
            return 0;
        }

        return DB::transaction(function () use (&$state) {
            $changed = 0;
            $keepAsIs = []; // ids proven Berlin: the twin of a stale UTC row

            DB::table('driver_metrics')->where('id', '<=', $state['metrics_cutoff'])
                ->orderBy('id')
                ->chunkById(self::METRICS_CHUNK, function ($rows) use (&$changed, &$keepAsIs) {
                    foreach ($rows as $row) {
                        if (isset($keepAsIs[$row->id])
                            || $this->isOldFallbackPeriod($row->period_start)
                            || $this->twinOf($row, $this->utcFromBerlin(...)) !== null) {
                            continue; // already Berlin wall-clock
                        }

                        $start = $this->berlinFromUtc($row->period_start);
                        $end = $this->berlinFromUtc($row->period_end);
                        $twinId = $this->twinOf($row, $this->berlinFromUtc(...));

                        if ($twinId !== null) {
                            $keepAsIs[$twinId] = true;
                            DB::table('driver_metrics')->where('id', $row->id)->delete();
                        } else {
                            DB::table('driver_metrics')->where('id', $row->id)
                                ->update(['period_start' => $start, 'period_end' => $end]);
                        }
                        $changed++;
                    }
                });

            $state['metrics_done'] = true;
            $this->saveState($state);

            return $changed;
        });
    }

    /**
     * Id of another metric row of the same driver whose period equals this row's
     * period mapped through $shift (Berlin→UTC finds a stale UTC twin, meaning this
     * row is the new-code Berlin capture; UTC→Berlin finds the Berlin twin).
     *
     * @param  callable(?string): ?string  $shift
     */
    private function twinOf(object $row, callable $shift): ?int
    {
        $id = DB::table('driver_metrics')
            ->where('driver_id', $row->driver_id)
            ->where('period_start', $shift($row->period_start))
            ->where('period_end', $shift($row->period_end))
            ->where('id', '!=', $row->id)
            ->value('id');

        return $id === null ? null : (int) $id;
    }

    private function offerChunk(int $from, int $to): Builder
    {
        return DB::table('dispatch_offers')
            ->whereBetween('id', [$from, $to])
            ->whereNotNull('received_at');
    }

    /**
     * The old parser's fallback (no timeRange) stored the Berlin week start,
     * Monday 00:00:00 — already correct. A UTC-stored Uber boundary never lands there.
     */
    private function isOldFallbackPeriod(?string $start): bool
    {
        if ($start === null) {
            return false;
        }

        $at = CarbonImmutable::parse($start);

        return $at->isMonday() && $at->format('H:i:s') === '00:00:00';
    }

    private function berlinFromUtc(?string $utc): ?string
    {
        return $utc === null ? null : CarbonImmutable::parse($utc, 'UTC')->setTimezone('Europe/Berlin')->format('Y-m-d H:i:s');
    }

    private function utcFromBerlin(?string $berlin): ?string
    {
        return $berlin === null ? null : CarbonImmutable::parse($berlin, 'Europe/Berlin')->utc()->format('Y-m-d H:i:s');
    }

    /** SQL: the column is at least UTC_LAG_MINUTES before received_at (i.e. still UTC). */
    private function utcLag(string $column): string
    {
        $minutes = self::UTC_LAG_MINUTES;

        return DB::connection()->getDriverName() === 'sqlite'
            ? "{$column} < datetime(received_at, '-{$minutes} minutes')"
            : "{$column} < received_at - INTERVAL {$minutes} MINUTE";
    }

    /**
     * Column => SQL expression turning its UTC wall-clock value into Berlin
     * wall-clock: +2 h inside a summer-time window (last Sunday of March 01:00 UTC →
     * last Sunday of October 01:00 UTC), +1 h otherwise. Windows are literal UTC
     * instants, so no MySQL time-zone tables are needed. NULL stays NULL.
     *
     * @param  array<int, string>  $columns
     * @return array<string, Expression>
     */
    private function toBerlin(array $columns): array
    {
        $sqlite = DB::connection()->getDriverName() === 'sqlite';
        $values = [];

        foreach ($columns as $column) {
            $summer = [];
            for ($year = 2020; $year <= 2040; $year++) {
                $start = CarbonImmutable::parse("last sunday of march {$year} 01:00", 'UTC')->format('Y-m-d H:i:s');
                $end = CarbonImmutable::parse("last sunday of october {$year} 01:00", 'UTC')->format('Y-m-d H:i:s');
                $summer[] = "({$column} >= '{$start}' AND {$column} < '{$end}')";
            }
            $isSummer = implode(' OR ', $summer);

            $values[$column] = DB::raw($sqlite
                ? "CASE WHEN {$column} IS NULL THEN NULL WHEN {$isSummer} THEN datetime({$column}, '+2 hours') ELSE datetime({$column}, '+1 hours') END"
                : "CASE WHEN {$column} IS NULL THEN NULL WHEN {$isSummer} THEN {$column} + INTERVAL 2 HOUR ELSE {$column} + INTERVAL 1 HOUR END");
        }

        return $values;
    }

    /**
     * Progress lives in the settings table (NOT the cache: every deploy runs
     * optimize:clear). The cutoffs are recorded on the first run only.
     *
     * @return array{offers_cutoff: int, offers_done: int, metrics_cutoff: int, metrics_done: bool}
     */
    private function state(): array
    {
        $saved = json_decode((string) Settings::get(self::STATE_KEY, ''), true);
        if (is_array($saved) && isset($saved['offers_cutoff'], $saved['metrics_cutoff'])) {
            return [
                'offers_cutoff' => (int) $saved['offers_cutoff'],
                'offers_done' => (int) ($saved['offers_done'] ?? 0),
                'metrics_cutoff' => (int) $saved['metrics_cutoff'],
                'metrics_done' => (bool) ($saved['metrics_done'] ?? false),
            ];
        }

        $state = [
            'offers_cutoff' => (int) DB::table('dispatch_offers')->max('id'),
            'offers_done' => 0,
            'metrics_cutoff' => (int) DB::table('driver_metrics')->max('id'),
            'metrics_done' => false,
        ];
        $this->saveState($state);

        return $state;
    }

    /** @param array{offers_cutoff: int, offers_done: int, metrics_cutoff: int, metrics_done: bool} $state */
    private function saveState(array $state): void
    {
        Settings::setMany([self::STATE_KEY => json_encode($state)]);
    }
}
