<?php

use App\Domain\Fleet\Models\Driver;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/**
 * A driver's private real-time channel. A driver may only subscribe to their own
 * channel; the `driver` guard (Sanctum bearer) resolves the authenticated driver
 * from the token the app sends with the broadcasting-auth request.
 */
Broadcast::channel('driver.{driverId}', function ($user, int $driverId) {
    // Never a dashboard User whose users.id happens to equal a driver's id.
    return $user instanceof Driver && (int) $user->id === $driverId;
}, ['guards' => ['driver']]);

/**
 * A company's private real-time channel — the fleet dashboard subscribes to it to
 * receive live offer updates. Tenant isolation is enforced HERE: a dashboard user
 * may only subscribe to their OWN company's channel, so one manager can never see
 * another company's feed. A tenant-less user (e.g. super_admin) matches nothing.
 */
Broadcast::channel('company.{tenantId}', function ($user, int $tenantId) {
    return $user instanceof User && (int) ($user->tenant_id ?? 0) === $tenantId;
}, ['guards' => ['web', 'sanctum']]);
