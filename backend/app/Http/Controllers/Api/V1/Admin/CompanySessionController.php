<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\Models\SessionBrowser;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\SessionOutageTracker;
use App\Domain\Dispatch\UberAuthClient;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Tenancy\CompanyDataPurger;
use App\Domain\Tenancy\Models\Tenant;
use App\Http\Controllers\Controller;
use App\Http\Resources\Admin\CompanySessionResource;
use App\Http\Resources\Admin\SessionBrowserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Super-admin view + controls over a company's Uber fleet session. Cookies are
 * never exposed (CompanySessionResource whitelists fields).
 */
class CompanySessionController extends Controller
{
    public function show(Tenant $tenant): JsonResponse
    {
        $session = $this->sessionFor($tenant);

        return response()->json([
            'data' => $session ? new CompanySessionResource($session) : null,
        ]);
    }

    /** The company's Uber session outages over the last 30 days, with totals. */
    public function outages(Tenant $tenant, SessionOutageTracker $tracker): JsonResponse
    {
        return response()->json(['data' => $tracker->summary($tenant->id)]);
    }

    /** Health of the company's persistent session browser; `not_set_up` until it first reports. */
    public function sessionBrowser(Tenant $tenant): JsonResponse
    {
        $browser = SessionBrowser::where('tenant_id', $tenant->id)->first();

        return response()->json([
            'data' => $browser ? new SessionBrowserResource($browser) : ['state' => SessionBrowser::STATE_NOT_SET_UP],
        ]);
    }

    /**
     * Stop session: end the company's live Uber capture and make it stick, KEEPING all data. Stops
     * the persistent browser in uber-auth (else it keeps the session warm and re-adopts it), marks
     * the session needs_relink (the daemon streams, driver-status ingest and session-browser
     * "wanted" list only ever include ACTIVE sessions, so every feed stops; an admin-sourced
     * outage is never auto-rescued), releases its shard assignment, forgets the "daemon is feeding"
     * marker, and blocks the extension's silent auto-relink until the manager reconnects.
     * Nothing is deleted: offers, drivers, vehicles and metrics stay.
     */
    public function forceRelink(Tenant $tenant, FleetSessionService $service, UberAuthClient $uberAuth): JsonResponse
    {
        $sessions = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->get();
        abort_if($sessions->isEmpty(), 404, 'No session.');

        $tenant->blockAutolink();
        // Every row, not just the newest: a sibling left active would keep streaming.
        foreach ($sessions as $session) {
            $service->markNeedsRelink($session, 'admin');
            $session->forceFill(['shard_id' => null])->save();
        }
        $this->tearDownLiveCapture($tenant, $uberAuth);

        return response()->json(['data' => ['status' => UberFleetSession::STATUS_NEEDS_RELINK]]);
    }

    /**
     * Everything that keeps a company's capture alive besides its session rows: the uber-auth
     * browser (and its saved state file, so a restart cannot revive it), the "daemon is feeding"
     * marker. Callers MUST `blockAutolink()` first: the uber-auth drop is a slow network call and
     * the extension could re-capture the session meanwhile. The passkey, proxy and org binding stay.
     */
    private function tearDownLiveCapture(Tenant $tenant, UberAuthClient $uberAuth): void
    {
        DriverStatusIngestor::forgetDaemonFeeding((int) $tenant->id);
        $this->dropPersistentBrowser($tenant, $uberAuth);
    }

    /** Best-effort: an uber-auth hiccup must not fail the relink the admin already got. */
    private function dropPersistentBrowser(Tenant $tenant, UberAuthClient $uberAuth): void
    {
        if (! $uberAuth->configured()) {
            return;
        }
        $result = $uberAuth->dropSession($tenant);
        if (($result['ok'] ?? false) !== true) {
            Log::warning('session teardown: uber-auth browser drop failed', ['tenant_id' => $tenant->id, 'status' => $result['status'] ?? 'unknown']);

            return;
        }
        // uber-auth stops reporting a dropped browser, so its last "active" mirror would linger.
        SessionBrowser::updateOrCreate(
            ['tenant_id' => $tenant->id],
            ['state' => SessionBrowser::STATE_NOT_SET_UP, 'last_seen_at' => now()],
        );
    }

    /**
     * Cut session: delete the session rows (the company reads as disconnected, 409) AND fully tear
     * down the live capture so nothing revives it; a manual Connect is required. The passkey and
     * proxy binding are kept so the reconnect skips OTP.
     */
    public function destroy(Tenant $tenant, UberAuthClient $uberAuth): JsonResponse
    {
        $tenant->blockAutolink();
        $deleted = UberFleetSession::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
        $this->tearDownLiveCapture($tenant, $uberAuth);

        return response()->json(['data' => ['deleted' => $deleted]]);
    }

    /**
     * Disconnect AND wipe: delete the session plus all of the company's
     * operational fleet data (drivers, vehicles, offers, device tokens,
     * metrics). Keeps the tenant, its users and billing history. Returns the
     * per-entity delete counts for the confirmation toast.
     */
    public function purge(Tenant $tenant, CompanyDataPurger $purger): JsonResponse
    {
        return response()->json(['data' => $purger->purge($tenant)]);
    }

    private function sessionFor(Tenant $tenant): ?UberFleetSession
    {
        return UberFleetSession::withoutGlobalScopes()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('updated_at')
            ->first();
    }
}
