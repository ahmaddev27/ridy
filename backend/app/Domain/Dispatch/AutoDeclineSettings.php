<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use App\Domain\Tenancy\Models\Tenant;
use Illuminate\Database\Eloquent\Builder;

/**
 * Reads and writes a driver's own auto-decline ("Early decline") configuration and
 * history — docs/25. The shape is normalised on the way IN so the engine and the
 * apps only ever see one: money in integer cents (`value_e2`), distances in km.
 */
class AutoDeclineSettings
{
    public const REASONS = ['min_fare', 'min_price_per_km', 'reject_cities', 'max_pickup_distance', 'max_trip_distance'];

    /** How many of the driver's latest offers we mine for the city picker. */
    private const CITY_SAMPLE = 300;

    /**
     * @return array{feature_enabled: bool, admin_enabled: bool, enabled: bool, rules: array<string, array<string, mixed>>, available_cities: array<int, string>}
     */
    public function show(Driver $driver): array
    {
        return [
            'feature_enabled' => $this->featureEnabled($driver),
            'admin_enabled' => $driver->adminAutoDeclineEnabled(),
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
     * Persist the driver's validated config. The driver can never write `admin_enabled`
     * and can never be active without it: `enabled` is clamped off while the admin has
     * not allowed the driver. Only known rules and keys are kept.
     *
     * @param  array<string, mixed>  $input  validated request data
     */
    public function update(Driver $driver, array $input): void
    {
        $adminEnabled = $driver->adminAutoDeclineEnabled();

        $this->store($driver, [
            'admin_enabled' => $adminEnabled,
            'enabled' => $adminEnabled && (bool) ($input['enabled'] ?? false),
            'rules' => $this->normaliseRules($input['rules'] ?? []),
        ]);
    }

    /**
     * Company-admin write. Allowing a driver also switches them on (active at once; they
     * may opt out later). Revoking only clears `admin_enabled`, which locks them off.
     * Rules, when sent, replace the driver's rules (last write wins).
     *
     * @param  array<string, mixed>  $data  validated request data
     * @return array<string, mixed>
     */
    public function adminUpdate(Driver $driver, array $data): array
    {
        $wasAdminEnabled = $driver->adminAutoDeclineEnabled();
        $adminEnabled = $wasAdminEnabled;
        $enabled = $driver->autoDeclineEnabled();

        if (array_key_exists('admin_enabled', $data)) {
            $adminEnabled = (bool) $data['admin_enabled'];
            // Activate only on a fresh switch-on (false -> true). A repeated `true` must NOT
            // override a driver who has since opted out — only the admin's actual turn-on does.
            if ($adminEnabled && ! $wasAdminEnabled) {
                $enabled = true;
            }
        }

        $this->store($driver, [
            'admin_enabled' => $adminEnabled,
            'enabled' => $enabled,
            'rules' => array_key_exists('rules', $data)
                ? $this->normaliseRules($data['rules'] ?? [])
                : $this->withDefaults($driver->autoDeclineRules()),
        ]);

        return $this->stateRow($driver->refresh(), $this->featureEnabled($driver));
    }

    /**
     * Every driver of the current tenant with their permission/opt-in state — the
     * admin's control list (unlike enabledDrivers(), includes drivers still switched off).
     *
     * @return array{feature_enabled: bool, available_cities: array<int, string>, drivers: array<int, array<string, mixed>>}
     */
    public function allDriversWithState(Tenant $tenant): array
    {
        $feature = $tenant->autoDeclineFeatureEnabled() === true;
        $drivers = Driver::query()->orderBy('name')->get(['id', 'name', 'auto_decline']);

        return [
            'feature_enabled' => $feature,
            'available_cities' => $this->tenantCities(),
            'drivers' => $drivers->map(fn (Driver $d) => $this->stateRow($d, $feature))->values()->all(),
        ];
    }

    /** @return array<string, mixed> */
    private function stateRow(Driver $driver, bool $feature): array
    {
        return [
            'id' => $driver->id,
            'name' => $driver->name,
            'admin_enabled' => $driver->adminAutoDeclineEnabled(),
            'enabled' => $driver->autoDeclineEnabled(),
            'active' => $feature && $driver->autoDeclineActive(),
            'rules' => $this->withDefaults($driver->autoDeclineRules()),
        ];
    }

    /** @param  array<string, mixed>  $config */
    private function store(Driver $driver, array $config): void
    {
        $driver->forceFill(['auto_decline' => $config])->save();
    }

    /**
     * @param  array<string, mixed>  $rules
     * @return array<string, array<string, mixed>>
     */
    private function normaliseRules(array $rules): array
    {
        return $this->withDefaults(array_combine(
            self::REASONS,
            array_map(fn (string $key) => $rules[$key] ?? [], self::REASONS),
        ));
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
     * Fleet-wide history for the owner dashboard: every landed Early-declined offer of
     * the CURRENT tenant (the tenant scope applies), optionally narrowed to one driver.
     */
    public function fleetHistory(?int $driverId, ?string $reason, mixed $from, mixed $to): Builder
    {
        return DispatchOffer::query()
            ->whereNotNull('auto_decline_reason')
            ->whereNull('auto_decline_failed_at')
            ->when($driverId !== null, fn ($q) => $q->where('driver_id', $driverId))
            ->when($reason !== null, fn ($q) => $q->where('auto_decline_reason', $reason))
            ->when($from !== null, fn ($q) => $q->where('received_at', '>=', $from))
            ->when($to !== null, fn ($q) => $q->where('received_at', '<', $to));
    }

    /**
     * The current tenant's drivers that switched Early decline on, with their rules —
     * read-only legacy list (the owner never edits a driver's rules here). Filters on the
     * driver's own switch; the admin-aware state lives on GET /auto-decline/drivers.
     *
     * @return array<int, array{id: int, name: string, rules: array<string, array<string, mixed>>}>
     */
    public function enabledDrivers(): array
    {
        return Driver::query()
            ->whereNotNull('auto_decline')
            ->orderBy('name')
            ->get(['id', 'name', 'auto_decline'])
            ->filter(fn (Driver $d) => $d->autoDeclineEnabled())
            ->map(fn (Driver $d) => ['id' => $d->id, 'name' => $d->name, 'rules' => $this->withDefaults($d->autoDeclineRules())])
            ->values()
            ->all();
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
            'min_price_per_km' => [
                'enabled' => $on('min_price_per_km'),
                'value_e2' => max(0, (int) ($rules['min_price_per_km']['value_e2'] ?? 0)),
                'mode' => ($rules['min_price_per_km']['mode'] ?? 'and') === 'or' ? 'or' : 'and',
            ],
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

        return $this->citiesFrom($rows);
    }

    /**
     * @param  iterable<DispatchOffer>  $rows
     * @return array<int, string>
     */
    private function citiesFrom(iterable $rows): array
    {
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

    /**
     * Cities across the tenant's recent offers, for the admin's rule editor.
     *
     * @return array<int, string>
     */
    private function tenantCities(): array
    {
        $rows = DispatchOffer::query()->latest('id')->limit(self::CITY_SAMPLE)
            ->get(['pickup_address', 'dropoff_address']);

        return $this->citiesFrom($rows);
    }

    private function cityOf(?string $address): ?string
    {
        if ($address === null || ! preg_match('/\b(\d{5})\b/', $address, $m)) {
            return null;
        }

        return PostalCodes::city($m[1]);
    }
}
