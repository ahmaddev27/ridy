<?php

use App\Domain\Fleet\Models\Driver;
use Illuminate\Support\Facades\Broadcast;

/**
 * A driver's private real-time channel. A driver may only subscribe to their own
 * channel; the `driver` guard (Sanctum bearer) resolves the authenticated driver
 * from the token the app sends with the broadcasting-auth request.
 */
Broadcast::channel('driver.{driverId}', function (Driver $driver, int $driverId) {
    return (int) $driver->id === $driverId;
}, ['guards' => ['driver']]);
