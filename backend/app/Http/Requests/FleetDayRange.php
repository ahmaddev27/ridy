<?php

namespace App\Http\Requests;

use App\Support\FleetDay;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The `from` / `to` fleet-day filters every stats and list endpoint accepts,
 * validated in ONE place. Unvalidated, a malformed date 500'd
 * (InvalidFormatException) and an unbounded range made the per-day zero-fill loop
 * build millions of rows (from=0001-01-01&to=9999-12-31) — a cheap DoS on the
 * shared PHP-FPM pool that also serves offer ingest.
 *
 * Dates are calendar labels (Y-m-d); each maps to its 04:00 fleet-day window.
 */
final class FleetDayRange
{
    /** Longest span a stats window may cover (a year, plus a leap day). */
    public const MAX_DAYS = 366;

    /**
     * A bounded stats window [from 04:00, to+1 04:00) — `to` exclusive — defaulting
     * to the last $defaultDays fleet-days through today.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     *
     * @throws ValidationException 422 on a malformed, reversed or over-long range
     */
    public static function window(Request $request, int $defaultDays, int $maxDays = self::MAX_DAYS): array
    {
        [$from, $to] = self::filters($request);

        $from ??= FleetDay::startDaysAgo($defaultDays);
        $to ??= FleetDay::todayStart()->addDay();

        if ($from->diffInDays($to) > $maxDays + 1) {
            throw ValidationException::withMessages(['to' => ["The date range may span at most {$maxDays} days."]]);
        }

        return [$from, $to];
    }

    /**
     * The optional list filters as fleet-day bounds (null when absent). Validates
     * the format only — list queries don't zero-fill, so no span cap is needed.
     *
     * @return array{0: CarbonImmutable|null, 1: CarbonImmutable|null}
     *
     * @throws ValidationException 422 on a malformed or reversed range
     */
    public static function filters(Request $request): array
    {
        $rules = [
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ];
        if ($request->filled('from') && $request->filled('to')) {
            $rules['to'][] = 'after_or_equal:from';
        }
        $request->validate($rules);

        return [
            $request->filled('from') ? FleetDay::startOfDate((string) $request->string('from')) : null,
            $request->filled('to') ? FleetDay::endOfDate((string) $request->string('to')) : null,
        ];
    }
}
