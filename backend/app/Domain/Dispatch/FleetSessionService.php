<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Notifications\FleetSessionOpened;
use App\Domain\Tenancy\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Notification;

/**
 * Stores a captured Uber fleet browser session and binds the tenant to its Uber
 * org. Once stored active, the dispatch daemon can open the RAMEN stream with it.
 */
class FleetSessionService
{
    /**
     * @param  array<int, array<string, mixed>>  $cookies  captured cookie jar
     */
    public function capture(
        Tenant $tenant,
        string $uberOrgUuid,
        array $cookies,
        ?CarbonImmutable $expiresAt = null,
    ): UberFleetSession {
        // Binding the tenant to its Uber org lets offers (which carry partnerUUID)
        // resolve back to this tenant during ingest.
        $tenant->forceFill(['uber_org_uuid' => $uberOrgUuid])->save();

        $session = UberFleetSession::updateOrCreate(
            ['tenant_id' => $tenant->id, 'uber_org_uuid' => $uberOrgUuid],
            [
                'cookies' => $cookies,
                'expires_at' => $expiresAt,
                'status' => UberFleetSession::STATUS_ACTIVE,
            ],
        );

        // Alert the fleet's managers that a fresh session is now live.
        $managers = User::where('tenant_id', $tenant->id)->get();
        Notification::send($managers, new FleetSessionOpened($session));

        return $session;
    }

    /**
     * Flag a session that the daemon found rejected by Uber, so the manager is
     * prompted to reconnect and the daemon stops using it.
     */
    public function markNeedsRelink(UberFleetSession $session): void
    {
        $session->forceFill(['status' => UberFleetSession::STATUS_NEEDS_RELINK])->save();
    }
}
