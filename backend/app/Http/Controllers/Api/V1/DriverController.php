<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Audit\AuditLogger;
use App\Domain\Dispatch\FleetSessionService;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Fleet\LiveFleetPositions;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\SafeBroadcast;
use App\Domain\Privacy\DriverEraser;
use App\Domain\Tenancy\TenantContext;
use App\Events\DriversBroadcast;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IngestDriverStatusesRequest;
use App\Http\Requests\FleetDayRange;
use App\Http\Resources\DriverResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DriverController extends Controller
{
    use AuthorizesTenantResource;

    public function index(): AnonymousResourceCollection
    {
        // The manager's fleet list shows only active drivers: hide anyone Uber
        // dropped from the roster (roster_removed_at) or marked inactive on their
        // side. Drivers we don't source from Uber (null uber_status) always show.
        // The rows stay in the DB — the admin views still list them.
        //
        // Ordered live-first (on-trip → en-route → online → offline), then by name,
        // so the drivers who are working right now are at the top — mirrors the
        // admin fleet directory. See Driver::scopeLiveFirst.
        //
        // The multi-column order still filesorts. Deferred join: sort/paginate on id
        // + the sort columns only (never the driver JSON columns trip_waypoints/
        // external_ids), so the sort buffer stays small (avoids 1038 out-of-sort-
        // memory on a large fleet), then fetch the page's full rows by id.
        $page = Driver::query()->activeFleet()
            ->select('id', 'name', 'engagement', 'is_online')
            ->liveFirst()
            ->paginate(50);

        $drivers = Driver::query()->whereIn('id', $page->pluck('id'))->with('latestDeviceToken')
            ->liveFirst()
            ->get();

        $page->setCollection($drivers);

        return DriverResource::collection($page);
    }

    /** Drivers with a live position for the fleet map — see LiveFleetPositions. */
    public function live(LiveFleetPositions $positions, TenantContext $context): JsonResponse
    {
        return response()->json(['data' => $positions->forTenant($context->get())]);
    }

    /** A single driver (tenant-scoped by route-model binding) for the profile page. */
    public function show(Driver $driver): DriverResource
    {
        $this->authorizeTenant($driver);

        return new DriverResource($driver->load('latestDeviceToken'));
    }

    /**
     * Manager edits a driver's app login email (so a test account can be created
     * and invited without an Uber email). Route-model binding keeps it within the
     * manager's own tenant; the email stays globally unique across drivers.
     */
    public function update(Request $request, Driver $driver, DriverInvitationService $invitations): DriverResource
    {
        $this->authorizeTenant($driver);

        $data = $request->validate([
            'email' => ['nullable', 'email', 'max:255', Rule::unique('drivers', 'email')->ignore($driver->id)],
        ]);

        // PATCH semantics: an ABSENT email leaves the driver untouched, an empty one
        // clears it. Reading $data['email'] unconditionally 500'd on a body that
        // simply didn't carry the field.
        if (! array_key_exists('email', $data)) {
            return new DriverResource($driver);
        }

        $email = $data['email'] ?: null;
        if ($email !== null) {
            $invitations->assertEmailAvailable($driver, $email);
        }

        if ($email === $driver->email) {
            return new DriverResource($driver);
        }

        // A NEW login address means a new person may hold the account (the phone
        // changed hands, a test login was re-pointed). Sign the previous holder out
        // everywhere and stop pushing offers to their devices; the new address
        // signs in with its own one-time code. Their passkeys go too: a passkey
        // is a sign-in that needs no code, so left alive it would keep the
        // previous holder's phone on the account after the address moved on.
        DB::transaction(function () use ($driver, $email) {
            $driver->tokens()->delete();
            $driver->webauthnCredentials()->delete();
            DeviceToken::withoutGlobalScopes()->where('driver_id', $driver->id)->delete();
            $driver->forceFill(['email' => $email, 'invite_token' => null])->save();
        });

        return new DriverResource($driver);
    }

    /**
     * Erase one driver (DSGVO Art. 17 request routed through the fleet) with the
     * same eraser as `drivers:erase`: row, logins, devices, metrics, notifications
     * and OTP rows deleted, offer history anonymized. Refused
     * while Uber still lists the driver on the fleet (a sync would recreate them).
     */
    public function destroy(Driver $driver, DriverEraser $eraser): JsonResponse
    {
        $this->authorizeTenant($driver);
        $eraser->assertErasable($driver);

        return response()->json(['data' => $eraser->erase($driver)]);
    }

    /**
     * Mark / unmark a driver as a manager (route is `can:users.manage`, owner only).
     * Not mass-assignable, so written through forceFill. An owner who is also this
     * driver (same login email) can't change their own flag.
     */
    public function setManager(Request $request, Driver $driver, AuditLogger $audit): DriverResource
    {
        $this->authorizeTenant($driver);

        $data = $request->validate(['is_manager' => ['required', 'boolean']]);
        $isManager = (bool) $data['is_manager'];

        $ownEmail = strtolower((string) $request->user()->email);
        abort_if($ownEmail !== '' && $ownEmail === strtolower((string) $driver->email), 403, 'cannot_change_own_manager_flag');

        if ($driver->is_manager !== $isManager) {
            $driver->forceFill(['is_manager' => $isManager])->save();
            $audit->log($isManager ? 'driver.manager_enabled' : 'driver.manager_disabled', $driver);
        }

        return new DriverResource($driver->load('latestDeviceToken'));
    }

    /** Work stats for one driver, computed from our own offers/acceptance data. */
    public function stats(Request $request, Driver $driver, DriverStatsService $stats): JsonResponse
    {
        $this->authorizeTenant($driver);

        // Fleet-day windows (04:00 boundary), $to exclusive; validated + span-capped.
        [$from, $to] = FleetDayRange::window($request, 30);

        return response()->json(['data' => $stats->forDriver($driver, $from, $to)]);
    }

    /**
     * The Ridy extension fetched supplier /api/getDrivers from the manager's own
     * browser (real IP, so Uber responds) and posts the driver list here. This is
     * the reliable path — server-side pulls get blocked by Uber's datacenter check.
     */
    public function ingestRoster(Request $request, RosterSyncService $roster, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'drivers' => ['required', 'array', 'max:'.RosterSyncService::MAX_DRIVERS],
            'drivers.*' => ['array'],
            'uber_org_uuid' => ['nullable', 'string', 'max:64'],
        ]);

        $tenant = $request->user()->tenant;

        // Connected-company gate is enforced by the fleet.connected middleware.
        // Here we additionally reject a roster whose org (when the extension
        // reports it) isn't this tenant's own bound fleet.
        $org = (string) ($data['uber_org_uuid'] ?? '');
        if ($org !== '' && $tenant->uber_org_uuid !== null && $tenant->uber_org_uuid !== $org) {
            abort(409, 'org_mismatch');
        }

        $recorder->roster((int) $tenant->id, $data['drivers']);
        $result = $roster->sync((int) $tenant->id, $data['drivers']);

        return response()->json(['data' => $result]);
    }

    /**
     * Live online/offline presence, posted by the extension after querying
     * Uber's GetDriverLiveLocation. Matched to drivers by Uber UUID.
     */
    public function ingestStatuses(IngestDriverStatusesRequest $request, DriverStatusIngestor $ingestor, SupplierNetworkRecorder $recorder, FleetSessionService $sessions): JsonResponse
    {
        $data = $request->validated();
        $tenantId = (int) $request->user()->tenant_id;

        // An admin Stop (autolink blocked / no active session) must stick: the manager's
        // open Fleet Hub tab would otherwise take over once the daemon marker is cleared.
        if ($request->user()->tenant?->isAutolinkBlocked() || ! $sessions->hasActiveSession($tenantId)) {
            return response()->json(['data' => ['updated' => 0, 'skipped' => 'session_stopped']]);
        }

        // The daemon polls the same statuses every few seconds; this extension batch
        // (once a minute, with fetch/post latency) is often OLDER than what the
        // daemon already applied. Two unordered writers fabricate engagement edges
        // (a fake ON_TRIP → EN_ROUTE completes a trip and accepts the wrong offer),
        // so while the daemon is feeding this company the extension only observes.
        if (DriverStatusIngestor::daemonIsFeeding($tenantId)) {
            return response()->json(['data' => ['updated' => 0, 'skipped' => 'daemon_active']]);
        }

        $recorder->statuses($tenantId, $data['statuses']);
        $result = $ingestor->ingest($tenantId, $data['statuses']);

        // Live dashboard map: nudge the company's channel so it refetches driver
        // positions instantly instead of waiting for its poll. Best-effort.
        SafeBroadcast::send(new DriversBroadcast($tenantId), ['tenant_id' => $tenantId]);

        return response()->json(['data' => $result]);
    }

    /**
     * The dashboard's "Sync" fallback when no extension answered. The backend
     * never calls Uber itself: replaying the company's live session from the
     * datacenter IP (bypassing its residential proxy) is what gets an Uber account
     * flagged, and it never worked anyway (blocked IP, wrong cookie jar). The
     * roster arrives through the extension (ingestRoster) and the daemon's
     * proxied 30-minute pull.
     */
    public function sync(): JsonResponse
    {
        return response()->json(['data' => ['synced' => 0, 'reason' => 'extension_required']]);
    }
}
