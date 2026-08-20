<?php

namespace App\Domain\Fleet;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use Carbon\CarbonImmutable;

/**
 * Per-driver work stats computed entirely from our own captured data (offers +
 * acceptance from the ON_TRIP signal) — independent of Uber's own metrics.
 * Earnings are summed from the offer fares of accepted rides.
 */
class DriverStatsService
{
    /** @return array<string, mixed> */
    public function forDriver(Driver $driver, CarbonImmutable $from, CarbonImmutable $to): array
    {
        // $to is an exclusive upper bound (fleet-day next-04:00 boundary).
        $offers = DispatchOffer::where('driver_uuid', $driver->uber_driver_uuid)
            ->where('received_at', '>=', $from)
            ->where('received_at', '<', $to)
            ->get(['fare_amount', 'distance_m', 'accepted_at', 'status']);

        $total = $offers->count();
        $acceptedCount = $offers->whereNotNull('accepted_at')->count();
        // Earnings + trips count COMPLETED rides only (a real, finished trip).
        $completed = $offers->where('status', OfferStatus::Completed);

        $earnings = $completed->sum(fn ($o) => (float) $o->fare_amount);
        $km = round($completed->sum('distance_m') / 1000, 1);

        return [
            'offers' => $total,
            'accepted' => $acceptedCount,
            'declined' => $total - $acceptedCount,
            'acceptance_rate' => $total > 0 ? (int) round($acceptedCount / $total * 100) : 0,
            'earnings' => round($earnings, 2),
            'trips' => $completed->count(),
            'km' => $km,
        ];
    }

    /**
     * Parse a formatted fare ("10,77 €", "€12.93", "8.50") to a float. Fleet
     * fares are small, so the last separator is always the decimal point.
     */
    public static function parseFare(?string $formatted): float
    {
        $n = preg_replace('/[^0-9.,]/', '', (string) $formatted);
        if ($n === '') {
            return 0.0;
        }

        $lastComma = strrpos($n, ',');
        $lastDot = strrpos($n, '.');
        $decPos = max($lastComma === false ? -1 : $lastComma, $lastDot === false ? -1 : $lastDot);

        if ($decPos < 0) {
            return (float) preg_replace('/[.,]/', '', $n);
        }

        $intPart = preg_replace('/[.,]/', '', substr($n, 0, $decPos));
        $decPart = preg_replace('/[.,]/', '', substr($n, $decPos + 1));

        return (float) ($intPart.'.'.$decPart);
    }
}
