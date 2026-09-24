<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Jobs\BackfillWaypointLabels;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Fleet\DriverInvitationService;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Notifications\SafeBroadcast;
use App\Domain\Privacy\DriverEraser;
use App\Events\DriversBroadcast;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\IngestDriverStatusesRequest;
use App\Http\Requests\FleetDayRange;
use App\Http\Resources\DriverResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DriverController extends Controller
{
    use AuthorizesTenantResource;

    /** How long a cold waypoint label, once queued, isn't queued again. */
    private const LABEL_BACKFILL_COOLDOWN_SECONDS = 120;

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

    /**
     * Drivers with a live position for the fleet map. Only engaged drivers
     * (EN_ROUTE / ON_TRIP) have real coordinates — Uber redacts idle/offline
     * drivers to 0,0, which the ingestor stores as null — so the map naturally
     * shows only active trips, each with its pickup/dropoff waypoints.
     */
    public function live(TripGeocoder $geo): JsonResponse
    {
        // Only show genuinely-live positions: a driver whose status hasn't been
        // synced within this window (dead session / closed extension) must drop
        // off the map instead of freezing in place and looking live.
        $freshSince = now()->subMinutes(Driver::LIVE_STALE_MINUTES);

        $liveDrivers = Driver::query()
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            // Belt-and-suspenders with the ingestor's bounds check: never plot a
            // fix outside a generous Germany/DACH box, so a bad coordinate already
            // stored (from before the ingest guard) is hidden immediately instead
            // of waiting for the next status sync to overwrite it.
            ->whereBetween('latitude', [45.0, 56.0])
            ->whereBetween('longitude', [4.0, 17.0])
            ->where('status_synced_at', '>=', $freshSince)
            ->get();

        // Resolve every waypoint's street label from a SINGLE geocode_cache query
        // (not one per waypoint per driver) and NEVER hit the network in this
        // user-facing poll: cold points fall back to the nearest town and are
        // reverse-geocoded out-of-band so the label appears on a later poll.
        $allPoints = [];
        foreach ($liveDrivers as $d) {
            foreach ($d->trip_waypoints ?? [] as $w) {
                $allPoints[] = [(float) ($w['lat'] ?? 0), (float) ($w['lng'] ?? 0)];
            }
        }
        $cachedLabels = $geo->cachedReverseLabels($allPoints);

        $misses = [];
        // Nearest-town lookups memoised per request: drivers and their waypoints
        // often share a point (same pickup, same station), so each is computed once.
        $towns = [];
        $nearest = function (float $lat, float $lng) use (&$towns): ?array {
            $key = round($lat, 3).','.round($lng, 3);

            return $towns[$key] ??= PostalCodes::nearest($lat, $lng);
        };

        $drivers = $liveDrivers->map(function (Driver $d) use ($geo, $cachedLabels, &$misses, $nearest) {
            // Reverse the live GPS to the nearest town so the fleet map can show
            // where each driver currently is (updates every poll).
            $near = $nearest((float) $d->latitude, (float) $d->longitude);

            return [
                'id' => $d->id,
                'name' => $d->name,
                'phone' => $d->phone,
                'city' => $near['city'] ?? null,
                'plz' => $near['plz'] ?? null,
                'picture' => $d->uber_picture_url,
                'status' => $d->online_status,
                'lat' => (float) $d->latitude,
                'lng' => (float) $d->longitude,
                'heading' => $d->heading !== null ? (float) $d->heading : null,
                // Label each pickup/dropoff from the batched cache; the nearest town
                // is the always-available fallback while a cold point is backfilled.
                'waypoints' => collect($d->trip_waypoints ?? [])->map(function ($w) use ($geo, $cachedLabels, &$misses, $nearest) {
                    $lat = (float) ($w['lat'] ?? 0);
                    $lng = (float) ($w['lng'] ?? 0);
                    $near = $nearest($lat, $lng);
                    $key = $geo->reverseCacheKey($lat, $lng);
                    $address = $key !== null ? ($cachedLabels[$key] ?? null) : null;
                    if ($key !== null && $address === null) {
                        $misses[$key] = [$lat, $lng]; // dedupe cold points by cache key
                    }

                    return array_merge($w, [
                        'address' => $address,
                        'city' => $near['city'] ?? null,
                        'plz' => $near['plz'] ?? null,
                    ]);
                })->all(),
                'location_updated_at' => $d->location_updated_at,
            ];
        });

        // Fill cold labels off the request path so the next poll serves them warm.
        // Each cold point is queued ONCE per couple of minutes, not by every open
        // dashboard on every 12 s poll (a Nominatim outage used to flood the queue).
        $fresh = array_values(array_filter(
            $misses,
            fn ($key) => Cache::add('revgeo:inflight:'.$key, 1, self::LABEL_BACKFILL_COOLDOWN_SECONDS),
            ARRAY_FILTER_USE_KEY,
        ));
        foreach (array_chunk($fresh, BackfillWaypointLabels::MAX_POINTS) as $chunk) {
            BackfillWaypointLabels::dispatch($chunk);
        }

        return response()->json(['data' => $drivers]);
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
        // signs in with its own one-time code.
        DB::transaction(function () use ($driver, $email) {
            $driver->tokens()->delete();
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
    public function ingestStatuses(IngestDriverStatusesRequest $request, DriverStatusIngestor $ingestor, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validated();
        $tenantId = (int) $request->user()->tenant_id;

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
