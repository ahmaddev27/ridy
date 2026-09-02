<?php

use App\Domain\Fleet\Models\Driver;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/**
 * A driver's private real-time channel. A driver may only subscribe to their own
 * channel; the `driver` guard (Sanctum bearer) resolves the authenticated driver
 * from the token the app sends with the broadcasting-auth request.
 */
Broadcast::channel('driver.{driverId}', function (Driver $driver, int $driverId) {
    return (int) $driver->id === $driverId;
}, ['guards' => ['driver']]);

/**
 * A company's private real-time channel — the fleet dashboard subscribes to it to
 * receive live offer updates. Tenant isolation is enforced HERE: a dashboard user
 * may only subscribe to their OWN company's channel, so one manager can never see
 * another company's feed. A tenant-less user (e.g. super_admin) matches nothing.
 */
Broadcast::channel('company.{tenantId}', function (User $user, int $tenantId) {
    return (int) ($user->tenant_id ?? 0) === $tenantId;
}, ['guards' => ['web', 'sanctum']]);
