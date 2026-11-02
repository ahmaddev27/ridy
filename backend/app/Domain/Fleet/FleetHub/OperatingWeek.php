<?php

namespace App\Domain\Fleet\FleetHub;

use App\Domain\Fleet\Earnings\EarningsReport;
use Carbon\CarbonImmutable;

/** The Uber operating week the server-side pulls ask for. */
final class OperatingWeek
{
    /**
     * Monday 04:00 -> next Monday 04:00 Berlin. Before 04:00 the operating day
     * is still the previous calendar day, so the week is judged from now-4h.
     *
     * @return array{0: int, 1: int} epoch ms
     */
    public static function currentMs(CarbonImmutable $now): array
    {
        $operatingDay = $now->setTimezone((string) config('app.timezone'))
            ->subHours(EarningsReport::UBER_OPERATING_DAY_START_HOUR);
        $monday = $operatingDay->startOfWeek();

        return EarningsReport::windowMs($monday, $monday->addDays(6));
    }
}
