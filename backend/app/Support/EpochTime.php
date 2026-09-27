<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * Epoch-millisecond timestamps (Uber sends every time as one) as app-timezone
 * datetimes. Carbon's createFromTimestampMs() returns a UTC instance and Eloquent
 * formats a Carbon value WITHOUT converting its zone, so a bare call stored UTC
 * wall-clock time next to columns that hold Europe/Berlin wall-clock time — 1-2
 * hours off. Always convert through here.
 */
final class EpochTime
{
    /**
     * The epoch-ms value in the app timezone, or null for a non-numeric, zero,
     * negative or pre-2000 value (offline drivers carry 0/garbage that would
     * otherwise parse to year 0001, which MySQL datetime rejects).
     */
    public static function fromMs(mixed $millis): ?CarbonImmutable
    {
        if (! is_numeric($millis) || (int) $millis <= 0) {
            return null;
        }

        $ts = CarbonImmutable::createFromTimestampMs((int) $millis)
            ->setTimezone((string) config('app.timezone'));

        return $ts->year >= 2000 ? $ts : null;
    }
}
