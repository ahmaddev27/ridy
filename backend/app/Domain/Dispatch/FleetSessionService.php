<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Stores a captured Uber fleet browser session and binds the tenant to its Uber
 * org. Once stored active, the dispatch daemon can open the RAMEN stream with it.
 */
class FleetSessionService
{
    public function __construct(
        private readonly Notifier $notifier,
        private readonly SupplierNetworkRecorder $recorder,
    ) {}

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

        // Was this org already streaming before this capture? Routine cookie
        // refreshes re-call capture() constantly; only a genuinely new or
        // reconnected session should notify, otherwise managers get spammed.
        $wasActive = UberFleetSession::where('tenant_id', $tenant->id)
            ->where('uber_org_uuid', $uberOrgUuid)
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->exists();

        $session = UberFleetSession::updateOrCreate(
            ['tenant_id' => $tenant->id, 'uber_org_uuid' => $uberOrgUuid],
            $attributes,
        );

        // Alert the fleet's managers only when the session actually (re)connects.
        if (! $wasActive) {
            $this->notifier->toTenant($tenant->id, 'session_connected', ['company' => $tenant->name], '/connections');
        }

        return $session;
    }

    /**
     * Flag a session that Uber rejected, so the manager is prompted to reconnect
     * and the daemon stops using it.
     *
     * $source records WHO detected the break ("daemon" = the server-side supplier
     * poll; "extension" = the manager's browser; "admin" = a forced relink), so
     * the network feed can answer "why did this session drop" instead of leaving us
     * to infer it from timestamps. Only the active→broken transition is logged, to
     * match the notification's own de-dupe.
     */
    public function markNeedsRelink(UberFleetSession $session, string $source = 'unknown'): void
    {
        $wasActive = $session->status === UberFleetSession::STATUS_ACTIVE;
        $session->forceFill(['status' => UberFleetSession::STATUS_NEEDS_RELINK])->save();

        // Record WHO flagged it on every call (even a no-op re-flag), so the feed
        // shows repeated breaks — that pattern is the signal for "something keeps
        // knocking this session out".
        $this->recorder->session((int) $session->tenant_id, 'needs_relink', ['source' => $source]);

        // Prompt the managers to reconnect — but only on the transition, and
        // deduped, so a persistently-broken session doesn't spam the bell. Pass
        // `company`: the push/email copy is "{company}: the Uber session needs
        // relinking" — without it the token rendered a literal "{company}".
        if ($wasActive) {
            $this->notifier->toTenant($session->tenant_id, 'session_needs_relink', ['company' => $this->companyName($session)], '/connections', dedupe: true);
        }
    }

    /**
     * Fleet Hub (roster/live-status) rejected the session, but the RAMEN OFFER
     * stream is still alive — so offers keep reaching drivers. Prompt the manager
     * to reconnect (which refreshes both cookie jars and restores acceptance +
     * the live map) WITHOUT flipping status: flipping to needs_relink would drop
     * the session from the daemon's active list and tear down the working offer
     * stream, which is the ~4.5h offer outage this method exists to prevent.
     */
    public function notifySupplierDegraded(UberFleetSession $session, string $source = 'unknown'): void
    {
        $this->recorder->session((int) $session->tenant_id, 'supplier_degraded', ['source' => $source]);

        // Same manager prompt as a real relink (deduped), since the fix is the same
        // action — reconnect — but the offer stream is untouched.
        $this->notifier->toTenant($session->tenant_id, 'session_needs_relink', ['company' => $this->companyName($session)], '/connections', dedupe: true);
    }

    private function companyName(UberFleetSession $session): string
    {
        return (string) (Tenant::whereKey($session->tenant_id)->value('name') ?? '');
    }
}
