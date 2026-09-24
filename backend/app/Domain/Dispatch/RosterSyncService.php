<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\DriverMetric;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Upserts a tenant's driver roster from Uber's supplier /api/getDrivers payload.
 * Keyed on the Uber driver UUID, so re-syncing updates in place and never
 * duplicates. Backfills the driver_id on any offers already captured for a UUID.
 */
class RosterSyncService
{
    /** Roster sync lock lifetime / how long a concurrent sync waits for it. */
    private const LOCK_SECONDS = 30;

    private const LOCK_WAIT_SECONDS = 10;

    public function __construct(private TenantContext $context) {}

    /**
     * @param  array<int, array<string, mixed>>  $drivers  the `data.drivers` array
     * @return array{synced: int, created: int, removed: int}
     */
    public function sync(int $tenantId, array $drivers): array
    {
        // Save and RESTORE the request-wide tenant context (as the offer ingestor
        // does), so a caller doing cross-tenant work afterwards isn't silently
        // scoped to the last synced tenant.
        $previous = $this->context->get();
        $this->context->set($tenantId);

        try {
            // The daemon push, the extension post and a manual sync can overlap;
            // serialized per company so two runs can't both create a new driver.
            return Cache::lock("roster-sync:{$tenantId}", self::LOCK_SECONDS)
                ->block(self::LOCK_WAIT_SECONDS, fn () => $this->syncLocked($tenantId, $drivers));
        } finally {
            $this->context->set($previous);
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $drivers
     * @return array{synced: int, created: int, removed: int}
     */
    private function syncLocked(int $tenantId, array $drivers): array
    {
        $created = 0;
        $synced = 0;
        $seen = [];

        // Preload every rostered driver in one grouped query (keyed by UUID) so
        // the loop resolves each canonical driver from memory instead of firing
        // one SELECT per row — the N+1 this sync used to pay on every pull.
        $uuids = [];
        foreach ($drivers as $row) {
            $uuid = $this->extractUuid($row);
            if ($uuid !== null) {
                $uuids[] = $uuid;
            }
        }
        $uuids = array_values(array_unique($uuids));

        // Skip the query on an empty roster so no `WHERE ... IN ()` is emitted.
        $existing = $uuids === []
            ? new Collection
            : Driver::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereIn('uber_driver_uuid', $uuids)
                ->orderBy('id')
                ->get()
                ->groupBy('uber_driver_uuid');

        // uuid => driver id of every rostered driver, for the orphan-offer backfill.
        $driverIdByUuid = [];

        foreach ($drivers as $row) {
            if (! is_array($row)) {
                continue;
            }
            $uuid = $this->extractUuid($row);
            if ($uuid === null) {
                continue;
            }
            $seen[] = $uuid;

            $driver = $this->canonicalDriver($tenantId, $existing->get($uuid));
            $wasNew = $driver === null;

            $attributes = [
                'tenant_id' => $tenantId,
                'name' => $this->fullName($row),
                'phone' => $this->phone($row),
                'uber_driver_uuid' => $uuid,
                // Uber's payload is outside our control: a non-scalar or oversized
                // field is dropped instead of 500ing the whole sync.
                'uber_email' => $this->text($row, 'email', 255),
                'uber_picture_url' => $this->httpsUrl($this->text($row, 'pictureUrl', 2048)),
                'uber_rating' => $this->number($row, 'recognitionRating'),
                'uber_total_trips' => $this->number($row, 'tripsInfo.totalCompletedTrips'),
                'uber_status' => $this->text($row, 'onboardingInfo.status', 64),
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
                // Register the fresh row so a duplicate of this UUID later in the
                // same roster resolves to it rather than creating a second driver.
                $existing->put($uuid, ($existing->get($uuid) ?? new Collection)->push($driver));
            } else {
                // Don't clobber a manual link method; only fill profile fields.
                unset($attributes['tenant_id']);
                $driver->fill($attributes)->save();
            }

            $driverIdByUuid[$uuid] = $driver->id;
            $synced++;
        }

        $this->linkOrphanOffers($tenantId, $driverIdByUuid);

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
     * Route offers that arrived for a rostered UUID before its driver existed (or
     * while unlinked). One index-served query finds the UUIDs that actually HAVE
     * orphan offers, and only those get a targeted UPDATE — on a normal sync that
     * is zero statements, instead of one UPDATE per driver that walked (and
     * next-key-locked) each driver's whole offer history against live ingest.
     *
     * @param  array<string, int>  $driverIdByUuid
     */
    private function linkOrphanOffers(int $tenantId, array $driverIdByUuid): void
    {
        foreach (array_chunk(array_keys($driverIdByUuid), 500) as $chunk) {
            $orphanUuids = DispatchOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereNull('driver_id')
                ->whereIn('driver_uuid', $chunk)
                ->distinct()
                ->pluck('driver_uuid');

            foreach ($orphanUuids as $uuid) {
                DispatchOffer::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('driver_uuid', $uuid)
                    ->whereNull('driver_id')
                    ->update(['driver_id' => $driverIdByUuid[$uuid]]);
            }
        }
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
    private function canonicalDriver(int $tenantId, ?Collection $group): ?Driver
    {
        // Rows arrive preloaded from the one grouped query above. Re-assert the
        // tenant_id in memory (no extra query) — this method DELETES rows, so it
        // must never reach across tenants even though the preload was already
        // tenant-scoped.
        $rows = ($group ?? new Collection)->where('tenant_id', $tenantId)->values();
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

        // All-or-nothing: a half-done merge would leave offers or a login token
        // pointing at a deleted driver id.
        DB::transaction(function () use ($extraIds, $canonical) {
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
        });

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
        $name = trim(($this->text($row, 'name.firstName', 120) ?? '').' '.($this->text($row, 'name.lastName', 120) ?? ''));

        return $name !== '' ? $name : 'Unbekannter Fahrer';
    }

    private function phone(array $row): ?string
    {
        $code = $this->text($row, 'phoneNumber.countryCode', 8);
        $number = $this->text($row, 'phoneNumber.number', 32);

        if (! $number) {
            return null;
        }

        return trim(($code ?? '').' '.$number);
    }

    /** A scalar roster field as a trimmed string capped at $max chars, else null. */
    private function text(array $row, string $key, int $max): ?string
    {
        $value = Arr::get($row, $key);
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function number(array $row, string $key): int|float|null
    {
        $value = Arr::get($row, $key);

        return is_numeric($value) ? $value + 0 : null;
    }

    /**
     * Only an https URL is kept for the driver picture: it is rendered as an
     * <img src> in manager and admin browsers, so anything else is dropped.
     */
    private function httpsUrl(?string $url): ?string
    {
        return $url !== null && str_starts_with(strtolower($url), 'https://') && filter_var($url, FILTER_VALIDATE_URL) !== false
            ? $url
            : null;
    }
}
