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
     * A span longer than $maxDays is CLAMPED to its latest $maxDays fleet-days
     * rather than refused: the dashboard's custom range sends such spans (a `from`
     * picked more than a year back) and used to get data, not an error.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     *
     * @throws ValidationException 422 on a malformed date
     */
    public static function window(Request $request, int $defaultDays, int $maxDays = self::MAX_DAYS): array
    {
        [$from, $to] = self::filters($request);

        $from ??= FleetDay::startDaysAgo($defaultDays);
        $to ??= FleetDay::todayStart()->addDay();

        return [$from->max($to->subDays($maxDays)), $to];
    }

    /**
     * The optional list filters as fleet-day bounds (null when absent). Validates
     * the format only — list queries don't zero-fill, so no span cap is needed.
     * A reversed pair (from after to, e.g. a dashboard custom range picked
     * backwards) is swapped instead of refused.
     *
     * @return array{0: CarbonImmutable|null, 1: CarbonImmutable|null}
     *
     * @throws ValidationException 422 on a malformed date
     */
    public static function filters(Request $request): array
    {
        // Plausible years only: 9999-12-31 + 1 day is not a valid MySQL datetime.
        $date = ['nullable', 'date_format:Y-m-d', 'after_or_equal:2000-01-01', 'before_or_equal:2099-12-31'];
        $request->validate(['from' => $date, 'to' => $date]);

        $fromDate = $request->filled('from') ? (string) $request->string('from') : null;
        $toDate = $request->filled('to') ? (string) $request->string('to') : null;

        // Y-m-d labels order correctly as strings.
        if ($fromDate !== null && $toDate !== null && $fromDate > $toDate) {
            [$fromDate, $toDate] = [$toDate, $fromDate];
        }

        return [
            $fromDate !== null ? FleetDay::startOfDate($fromDate) : null,
            $toDate !== null ? FleetDay::endOfDate($toDate) : null,
        ];
    }
}
