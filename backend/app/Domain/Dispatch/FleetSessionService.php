<?php

namespace App\Domain\Dispatch;

use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Notifications\Notifier;
use App\Domain\Tenancy\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

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
     * @param  bool  $replaceOtherOrgs  a manual Connect to a DIFFERENT org: drop the company's other org sessions
     */
    public function capture(
        Tenant $tenant,
        string $uberOrgUuid,
        array $cookies,
        ?CarbonImmutable $expiresAt = null,
        ?string $uberOrgName = null,
        ?array $supplierCookies = null,
        bool $replaceOtherOrgs = false,
    ): UberFleetSession {
        [$session, $wasActive] = DB::transaction(function () use ($tenant, $uberOrgUuid, $cookies, $expiresAt, $uberOrgName, $supplierCookies, $replaceOtherOrgs) {
            // Serialize captures per company (the extension auto-captures on every
            // Uber page load, so two can race).
            Tenant::whereKey($tenant->id)->lockForUpdate()->first();

            // One company = one Uber org. A deliberate switch drops the old org's
            // session(s); otherwise their roster syncs would keep marking each
            // other's drivers removed and both would stream through one proxy.
            if ($replaceOtherOrgs) {
                UberFleetSession::withoutGlobalScopes()
                    ->where('tenant_id', $tenant->id)
                    ->where('uber_org_uuid', '!=', $uberOrgUuid)
                    ->delete();
            }

            // Binding the tenant to its Uber org lets offers (which carry partnerUUID)
            // resolve back to this tenant during ingest. When Uber gives us the fleet
            // name at link time, adopt it as the company name.
            $tenant->forceFill(['uber_org_uuid' => $uberOrgUuid]);
            if ($uberOrgName !== null && trim($uberOrgName) !== '') {
                $tenant->name = trim($uberOrgName);
            }
            $tenant->save();

            $existing = UberFleetSession::withoutGlobalScopes()
                ->where('tenant_id', $tenant->id)
                ->where('uber_org_uuid', $uberOrgUuid)
                ->first();

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

            // A NEW jar (not the routine re-capture of the same values) gets a new
            // version, so the daemon's still-running stream on the previous jar can
            // no longer overwrite it or flag it broken (see DispatchDaemonController).
            if ($existing === null) {
                $attributes['jar_version'] = 1;
            } elseif ($this->jarChanged($existing, $cookies, $attributes['supplier_cookies'] ?? null)) {
                $attributes['jar_version'] = (int) $existing->jar_version + 1;
            }

            // Was this org already streaming before this capture? Routine cookie
            // refreshes re-call capture() constantly; only a genuinely new or
            // reconnected session should notify, otherwise managers get spammed.
            $wasActive = $existing !== null && $existing->status === UberFleetSession::STATUS_ACTIVE;

            if ($existing !== null) {
                $existing->forceFill($attributes)->save();

                return [$existing, $wasActive];
            }

            return [UberFleetSession::withoutGlobalScopes()->create(['tenant_id' => $tenant->id, 'uber_org_uuid' => $uberOrgUuid] + $attributes), false];
        });

        // Alert the fleet's managers only when the session actually (re)connects —
        // after commit, so a rolled-back capture never notifies.
        if (! $wasActive) {
            $this->notifier->toTenant($tenant->id, 'session_connected', ['company' => $tenant->name], '/connections');
        }

        return $session;
    }

    /**
     * Mark a session's org claim as proven: the daemon just read the org's Fleet
     * Hub data with the stored cookies. Only the first proof writes.
     */
    public function markVerified(UberFleetSession $session): void
    {
        if ($session->verified_at === null) {
            $session->forceFill(['verified_at' => CarbonImmutable::now()])->save();
        }
    }

    /**
     * Whether a capture's cookie VALUES differ from the stored jar(s). Order and
     * extra attributes (domain, expiry) don't count — only name=value pairs.
     *
     * @param  array<int, array<string, mixed>>  $cookies
     * @param  array<int, array<string, mixed>>|null  $supplierCookies
     */
    private function jarChanged(UberFleetSession $existing, array $cookies, ?array $supplierCookies): bool
    {
        if ($this->fingerprint($existing->cookies ?? []) !== $this->fingerprint($cookies)) {
            return true;
        }

        return $supplierCookies !== null
            && $this->fingerprint($existing->supplier_cookies ?? []) !== $this->fingerprint($supplierCookies);
    }

    /** @param  array<int, array<string, mixed>>  $jar */
    private function fingerprint(array $jar): string
    {
        $pairs = [];
        foreach ($jar as $cookie) {
            if (is_array($cookie) && isset($cookie['name'])) {
                $pairs[(string) $cookie['name']] = (string) ($cookie['value'] ?? '');
            }
        }
        ksort($pairs);

        return md5((string) json_encode($pairs));
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
