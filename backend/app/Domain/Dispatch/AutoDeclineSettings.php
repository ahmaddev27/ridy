<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use Illuminate\Database\Eloquent\Builder;

/**
 * Reads and writes a driver's own auto-decline ("Early decline") configuration and
 * history — docs/25. The shape is normalised on the way IN so the engine and the
 * apps only ever see one: money in integer cents (`value_e2`), distances in km.
 */
class AutoDeclineSettings
{
    public const REASONS = ['min_fare', 'reject_cities', 'max_pickup_distance', 'max_trip_distance'];

    /** How many of the driver's latest offers we mine for the city picker. */
    private const CITY_SAMPLE = 300;

    /**
     * @return array{feature_enabled: bool, enabled: bool, rules: array<string, array<string, mixed>>, available_cities: array<int, string>}
     */
    public function show(Driver $driver): array
    {
        return [
            'feature_enabled' => $this->featureEnabled($driver),
            'enabled' => $driver->autoDeclineEnabled(),
            'rules' => $this->withDefaults($driver->autoDeclineRules()),
            'available_cities' => $this->availableCities($driver),
        ];
    }

    public function featureEnabled(Driver $driver): bool
    {
        return $driver->tenant?->autoDeclineFeatureEnabled() === true;
    }

    /**
     * Persist the validated config. Only known rules and keys are kept.
     *
     * @param  array<string, mixed>  $input  validated request data
     */
    public function update(Driver $driver, array $input): void
    {
        $rules = $input['rules'] ?? [];

        $driver->forceFill(['auto_decline' => [
            'enabled' => (bool) ($input['enabled'] ?? false),
            'rules' => $this->withDefaults([
                'min_fare' => $rules['min_fare'] ?? [],
                'reject_cities' => $rules['reject_cities'] ?? [],
                'max_pickup_distance' => $rules['max_pickup_distance'] ?? [],
                'max_trip_distance' => $rules['max_trip_distance'] ?? [],
            ]),
        ]])->save();
    }

    /** The driver's own Early-declined offers whose decline actually landed. */
    public function history(Driver $driver, ?string $reason, mixed $from, mixed $to): Builder
    {
        return DispatchOffer::withoutGlobalScopes()
            ->where('driver_id', $driver->id)
            ->whereNotNull('auto_decline_reason')
            ->whereNull('auto_decline_failed_at')
            ->when($reason !== null, fn ($q) => $q->where('auto_decline_reason', $reason))
            ->when($from !== null, fn ($q) => $q->where('received_at', '>=', $from))
            ->when($to !== null, fn ($q) => $q->where('received_at', '<', $to));
    }

    /**
     * @param  array<string, mixed>  $rules
     * @return array<string, array<string, mixed>>
     */
    private function withDefaults(array $rules): array
    {
        $on = fn (string $key): bool => ($rules[$key]['enabled'] ?? false) === true;

        return [
            'min_fare' => ['enabled' => $on('min_fare'), 'value_e2' => max(0, (int) ($rules['min_fare']['value_e2'] ?? 0))],
            'reject_cities' => ['enabled' => $on('reject_cities'), 'cities' => $this->cities($rules['reject_cities']['cities'] ?? [])],
            'max_pickup_distance' => ['enabled' => $on('max_pickup_distance'), 'km' => $this->km($rules['max_pickup_distance']['km'] ?? 0)],
            'max_trip_distance' => ['enabled' => $on('max_trip_distance'), 'km' => $this->km($rules['max_trip_distance']['km'] ?? 0)],
        ];
    }

    /** @return array<int, string> */
    private function cities(mixed $cities): array
    {
        if (! is_array($cities)) {
            return [];
        }

        $clean = array_map(fn ($c) => is_string($c) ? trim($c) : '', $cities);

        return array_values(array_unique(array_filter($clean, fn (string $c) => $c !== '')));
    }

    private function km(mixed $km): int|float
    {
        return is_numeric($km) ? max(0, $km + 0) : 0;
    }

    /**
     * Cities the driver actually gets offers in, from the authoritative PLZ of their
     * recent pickups/dropoffs — so the picker offers real towns, spelled the way the
     * rest of the product spells them.
     *
     * @return array<int, string>
     */
    private function availableCities(Driver $driver): array
    {
        $rows = DispatchOffer::withoutGlobalScopes()
            ->where('driver_id', $driver->id)
            ->latest('id')
            ->limit(self::CITY_SAMPLE)
            ->get(['pickup_address', 'dropoff_address']);

        $cities = [];
        foreach ($rows as $row) {
            foreach ([$row->pickup_address, $row->dropoff_address] as $address) {
                $city = $this->cityOf($address);
                if ($city !== null) {
                    $cities[$city] = true;
                }
            }
        }

        $names = array_keys($cities);
        sort($names, SORT_LOCALE_STRING);

        return $names;
    }

    private function cityOf(?string $address): ?string
    {
        if ($address === null || ! preg_match('/\b(\d{5})\b/', $address, $m)) {
            return null;
        }

        return PostalCodes::city($m[1]);
    }
}
