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
     * @param  array<int, array<string, mixed>>  $cookies  captured cookie jar (vsdispatch scope, for RAMEN)
     * @param  array<int, array<string, mixed>>|null  $supplierCookies  supplier.uber.com-scoped jar (roster/status)
     */
    public function capture(
        Tenant $tenant,
        string $uberOrgUuid,
        array $cookies,
        ?CarbonImmutable $expiresAt = null,
        ?string $uberOrgName = null,
        ?array $supplierCookies = null,
    ): UberFleetSession {
        // Binding the tenant to its Uber org lets offers (which carry partnerUUID)
        // resolve back to this tenant during ingest. When Uber gives us the fleet
        // name at link time, adopt it as the company name.
        $tenant->forceFill(['uber_org_uuid' => $uberOrgUuid]);
        if ($uberOrgName !== null && trim($uberOrgName) !== '') {
            $tenant->name = trim($uberOrgName);
        }
        $tenant->save();

        $attributes = [
            'cookies' => $cookies,
            'expires_at' => $expiresAt,
            'status' => UberFleetSession::STATUS_ACTIVE,
        ];
        // Only overwrite the supplier jar when the extension actually sent one, so
        // an older extension (no supplier cookies) never wipes a good stored jar.
        if ($supplierCookies !== null && $supplierCookies !== []) {
            $attributes['supplier_cookies'] = $supplierCookies;
        }

        $session = UberFleetSession::updateOrCreate(
            ['tenant_id' => $tenant->id, 'uber_org_uuid' => $uberOrgUuid],
            $attributes,
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
