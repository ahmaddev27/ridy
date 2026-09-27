<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

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

    /**
     * Start (04:00) of the fleet-day labelled by a calendar date (Y-m-d or date).
     *
     * Strings come straight from request filters (?from=/?to=), so they are parsed
     * strictly: "Y-m-d" (optionally an ISO date-time) or a 422 — free text used to
     * 500, and relative words ("tomorrow") were silently accepted. A value carrying
     * an offset ("…Z") is moved to the app timezone first, so its 04:00 is Berlin's.
     *
     * @throws ValidationException on an unparseable string
     */
    public static function startOfDate(CarbonInterface|string $date): CarbonImmutable
    {
        $tz = (string) config('app.timezone');
        $d = $date instanceof CarbonInterface
            ? CarbonImmutable::instance($date)->setTimezone($tz)
            : self::parseDateString($date, $tz);

        return $d->setTime(self::START_HOUR, 0);
    }

    private static function parseDateString(string $value, string $tz): CarbonImmutable
    {
        $value = trim($value);
        $isoDate = '/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/';

        try {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
                $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $value, $tz);
                if ($parsed !== false && $parsed->format('Y-m-d') === $value) {
                    return $parsed;
                }
            } elseif (preg_match($isoDate, $value) === 1) {
                return CarbonImmutable::parse($value, $tz)->setTimezone($tz);
            }
        } catch (Throwable) {
            // fall through to the validation error
        }

        throw ValidationException::withMessages(['date' => 'The date must be in the format Y-m-d.']);
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
