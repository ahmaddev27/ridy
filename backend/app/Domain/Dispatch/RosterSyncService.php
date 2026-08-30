<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * Upserts a tenant's driver roster from Uber's supplier /api/getDrivers payload.
 * Keyed on the Uber driver UUID, so re-syncing updates in place and never
 * duplicates. Backfills the driver_id on any offers already captured for a UUID.
 */
class RosterSyncService
{
    public function __construct(private TenantContext $context) {}

    /**
     * @param  array<int, array<string, mixed>>  $drivers  the `data.drivers` array
     * @return array{synced: int, created: int, removed: int}
     */
    public function sync(int $tenantId, array $drivers): array
    {
        $this->context->set($tenantId);

        $created = 0;
        $synced = 0;
        $seen = [];

        foreach ($drivers as $row) {
            $uuid = $this->extractUuid($row);
            if ($uuid === null) {
                continue;
            }
            $seen[] = $uuid;

            $driver = $this->canonicalDriver($tenantId, $uuid);
            $wasNew = $driver === null;

            $attributes = [
                'tenant_id' => $tenantId,
                'name' => $this->fullName($row),
                'phone' => $this->phone($row),
                'uber_driver_uuid' => $uuid,
                'uber_email' => Arr::get($row, 'email'),
                'uber_picture_url' => Arr::get($row, 'pictureUrl'),
                'uber_rating' => Arr::get($row, 'recognitionRating'),
                'uber_total_trips' => Arr::get($row, 'tripsInfo.totalCompletedTrips'),
                'uber_status' => Arr::get($row, 'onboardingInfo.status'),
                'roster_synced_at' => CarbonImmutable::now(),
                // Present in this roster → clear any earlier "removed" mark (a
                // driver Uber had dropped and then re-added is active again).
                'roster_removed_at' => null,
            ];

            // A driver first seen via the roster is auto-linked to its UUID.
            if ($wasNew) {
                $attributes['uber_link_method'] = 'auto';
                $driver = Driver::create($attributes);
                $created++;
            } else {
                // Don't clobber a manual link method; only fill profile fields.
                unset($attributes['tenant_id']);
                $driver->fill($attributes)->save();
            }

            // Route any offers that arrived for this UUID before the driver existed.
            DispatchOffer::where('driver_uuid', $uuid)
                ->whereNull('driver_id')
                ->update(['driver_id' => $driver->id]);

            $synced++;
        }

        // Reconcile removals: a driver Uber no longer lists is marked removed from
        // the fleet — NEVER deleted. The row and its offer history stay with the
        // company (an admin can review or re-link later). Guarded on a non-empty
        // roster so a failed/partial pull can't wipe the whole fleet's status.
        $removed = 0;
        if ($seen !== []) {
            $removed = Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereNotNull('uber_driver_uuid')
                ->whereNotIn('uber_driver_uuid', $seen)
                ->whereNull('roster_removed_at')
                ->update(['roster_removed_at' => CarbonImmutable::now()]);
        }

        return ['synced' => $synced, 'created' => $created, 'removed' => $removed];
    }

    /**
     * The single canonical driver for a UUID, self-healing legacy duplicates.
     * uber_driver_uuid isn't unique, so older syncs (no tenant context) or two
     * sessions on one org could create several rows for one driver. Collapse the
     * extras into one — preferring a row that already has an app login, else one
     * with a pending invite, else the oldest — moving their offers + device
     * tokens over and dropping the extras (their metrics are re-derivable) so the
     * roster never lists a driver twice. A pending invite/login on any extra is
     * carried onto the canonical so a merge never invalidates an active invite.
     */
    private function canonicalDriver(int $tenantId, string $uuid): ?Driver
    {
        // Explicit tenant_id (not just the global scope) — this method DELETES
        // rows, so it must never reach across tenants even if the tenant context
        // were ever unset (the scope is a no-op then).
        $rows = Driver::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('uber_driver_uuid', $uuid)
            ->orderBy('id')
            ->get();
        if ($rows->isEmpty()) {
            return null;
        }
        if ($rows->count() === 1) {
            return $rows->first();
        }

        // Preference keeps whichever row matters most: a live app login first,
        // then a pending invite (so its unique invite_token/email survive as the
        // canonical row), else the oldest. This alone preserves an active invite
        // through the merge — no field copying (which would clash on the unique
        // invite_token/email while the extra still exists).
        $canonical = $rows->first(fn (Driver $d) => $d->activated_at !== null)
            ?? $rows->first(fn (Driver $d) => $d->invite_token !== null)
            ?? $rows->first();

        $extraIds = $rows->where('id', '!=', $canonical->id)->pluck('id');
        DispatchOffer::whereIn('driver_id', $extraIds)->update(['driver_id' => $canonical->id]);
        DeviceToken::whereIn('driver_id', $extraIds)->update(['driver_id' => $canonical->id]);
        // Carry the driver's app session (Sanctum tokens) onto the canonical row
        // BEFORE deleting the extras — otherwise a merge orphans the token to a
        // now-gone driver id and the driver's very next request 401s them out.
        DB::table('personal_access_tokens')
            ->where('tokenable_type', $canonical->getMorphClass())
            ->whereIn('tokenable_id', $extraIds)
            ->update(['tokenable_id' => $canonical->id]);
        DriverMetric::whereIn('driver_id', $extraIds)->delete();
        Driver::whereIn('id', $extraIds)->delete();

        return $canonical;
    }

    /** Uber wraps ids as nested objects; dig out the first 36-char UUID string. */
    private function extractUuid(array $row): ?string
    {
        $node = Arr::get($row, 'driverUuid');
        $found = null;

        $walk = function ($value) use (&$walk, &$found) {
            if ($found !== null) {
                return;
            }
            if (is_string($value) && preg_match('/^[0-9a-f-]{36}$/i', $value)) {
                $found = $value;

                return;
            }
            if (is_array($value)) {
                foreach ($value as $child) {
                    $walk($child);
                }
            }
        };

        $walk($node);

        return $found;
    }

    private function fullName(array $row): string
    {
        $name = trim(Arr::get($row, 'name.firstName', '').' '.Arr::get($row, 'name.lastName', ''));

        return $name !== '' ? $name : 'Unbekannter Fahrer';
    }

    private function phone(array $row): ?string
    {
        $code = Arr::get($row, 'phoneNumber.countryCode');
        $number = Arr::get($row, 'phoneNumber.number');

        if (! $number) {
            return null;
        }

        return trim(($code ?? '').' '.$number);
    }
}
