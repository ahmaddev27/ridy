<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * The fleet/business day follows Uber: it starts at 04:00 in the app timezone
 * (Europe/Berlin), NOT at midnight. So a trip at 02:30 belongs to the PREVIOUS
 * calendar date's fleet-day. Every offer/trip/driver-stat window, filter and
 * daily grouping runs through here so "today", search and statistics agree
 * across the backend, the dashboard and the mobile app.
 */
final class FleetDay
{
    /** Local hour the fleet day begins. */
    public const START_HOUR = 4;

    /** Start (04:00) of the fleet-day that CONTAINS the given moment (now by default). */
    public static function start(?CarbonInterface $ref = null): CarbonImmutable
    {
        $ref = $ref ? CarbonImmutable::instance($ref) : CarbonImmutable::now();
        $start = $ref->setTime(self::START_HOUR, 0);

        return $ref->hour < self::START_HOUR ? $start->subDay() : $start;
    }

    /** Start of the current fleet-day (today's 04:00, or yesterday's before 04:00). */
    public static function todayStart(): CarbonImmutable
    {
        return self::start();
    }

    /** Start of the fleet-day $days before the current one. */
    public static function startDaysAgo(int $days): CarbonImmutable
    {
        return self::start()->subDays($days);
    }

    /** Start (04:00) of the fleet-day labelled by a calendar date (Y-m-d or date). */
    public static function startOfDate(CarbonInterface|string $date): CarbonImmutable
    {
        $d = $date instanceof CarbonInterface ? CarbonImmutable::instance($date) : CarbonImmutable::parse($date);

        return $d->setTime(self::START_HOUR, 0);
    }

    /** Exclusive end (the next 04:00) of the fleet-day labelled by a calendar date. */
    public static function endOfDate(CarbonInterface|string $date): CarbonImmutable
    {
        return self::startOfDate($date)->addDay();
    }

    /**
     * SQL expression mapping a datetime column to its fleet-day DATE (shifted back
     * 4h), for GROUP BY / SELECT date aggregation. MySQL + SQLite compatible.
     */
    public static function dateExpr(string $column): string
    {
        $h = self::START_HOUR;

        return DB::connection()->getDriverName() === 'sqlite'
            ? "date({$column}, '-{$h} hours')"
            : "date({$column} - interval {$h} hour)";
    }
}
