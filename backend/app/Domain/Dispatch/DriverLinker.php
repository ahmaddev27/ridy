<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Fleet\Models\Driver;

/**
 * Links an Uber driver identity (driverUUID) to a fleet Driver record and
 * backfills any offers that arrived before the link existed. Linking is
 * idempotent on uber_driver_uuid.
 */
class DriverLinker
{
    public const METHOD_AUTO = 'auto';

    public const METHOD_MANUAL = 'manual';

    /**
     * Attach the given Uber UUID (and optional email) to a driver, then route
     * every previously-unlinked offer for that UUID to it.
     *
     * @return array{driver_id: int, backfilled_offers: int}
     */
    public function link(Driver $driver, string $uberDriverUuid, string $method, ?string $uberEmail = null): array
    {
        $driver->forceFill([
            'uber_driver_uuid' => $uberDriverUuid,
            'uber_email' => $uberEmail ?? $driver->uber_email,
            'uber_link_method' => $method,
        ])->save();

        $backfilled = DispatchOffer::where('driver_uuid', $uberDriverUuid)
            ->whereNull('driver_id')
            ->update(['driver_id' => $driver->id]);

        return ['driver_id' => $driver->id, 'backfilled_offers' => $backfilled];
    }

    /**
     * Auto-link flow: the driver signed into Uber in our app and we captured
     * their own getUser identity. Reuses an existing driver row for this UUID,
     * or provisions one from the captured name.
     *
     * @return array{driver_id: int, backfilled_offers: int, created: bool}
     */
    public function autoLinkFromGetUser(int $tenantId, string $uberDriverUuid, string $name, ?string $email = null): array
    {
        $driver = Driver::where('uber_driver_uuid', $uberDriverUuid)->first()
            ?? Driver::create(['tenant_id' => $tenantId, 'name' => $name]);

        $created = $driver->wasRecentlyCreated;
        $result = $this->link($driver, $uberDriverUuid, self::METHOD_AUTO, $email);

        return [...$result, 'created' => $created];
    }
}
