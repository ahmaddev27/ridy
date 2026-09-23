<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Jobs\BackfillWaypointLabels;
use App\Domain\Dispatch\Models\UberFleetSession;
use App\Domain\Dispatch\RosterSyncService;
use App\Domain\Dispatch\SupplierNetworkRecorder;
use App\Domain\Dispatch\TripGeocoder;
use App\Domain\Dispatch\UberSupplierClient;
use App\Domain\Fleet\DriverStatsService;
use App\Domain\Fleet\DriverStatusIngestor;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Geo\PostalCodes;
use App\Events\DriversBroadcast;
use App\Http\Controllers\Concerns\AuthorizesTenantResource;
use App\Http\Controllers\Controller;
use App\Http\Resources\DriverResource;
use App\Support\FleetDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

class DriverController extends Controller
{
    use AuthorizesTenantResource;

    /** A driver whose status hasn't synced within this many minutes is stale. */
    private const LIVE_STALE_MINUTES = 10;

    public function index(): AnonymousResourceCollection
    {
        // The manager's fleet list shows only active drivers: hide anyone Uber
        // dropped from the roster (roster_removed_at) or marked inactive on their
        // side. Drivers we don't source from Uber (null uber_status) always show.
        // The rows stay in the DB — the admin views still list them.
        //
        // Ordered live-first (on-trip → en-route → online → offline), then by name,
        // so the drivers who are working right now are at the top — mirrors the
        // admin fleet directory.
        $liveFirst = "CASE
                WHEN online_status LIKE '%ON_TRIP%' THEN 0
                WHEN online_status LIKE '%EN_ROUTE%' THEN 1
                WHEN online_status LIKE '%ONLINE%' THEN 2
                ELSE 3 END";

        // The live-first ORDER BY is a CASE expression that can never use an index,
        // so it always filesorts. Deferred join: sort/paginate on id + the sort
        // columns only (never the driver JSON columns trip_waypoints/external_ids),
        // so the sort buffer stays small (avoids 1038 out-of-sort-memory on a large
        // fleet), then fetch the page's full rows by id.
        $page = Driver::query()->activeFleet()
            ->select('id', 'name', 'online_status')
            ->orderByRaw($liveFirst)->orderBy('name')->orderBy('id')
            ->paginate(50);

        $drivers = Driver::query()->whereIn('id', $page->pluck('id'))->with('latestDeviceToken')
            ->orderByRaw($liveFirst)->orderBy('name')->orderBy('id')
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
        $freshSince = now()->subMinutes(self::LIVE_STALE_MINUTES);

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
        $drivers = $liveDrivers->map(function (Driver $d) use ($geo, $cachedLabels, &$misses) {
            // Reverse the live GPS to the nearest town so the fleet map can show
            // where each driver currently is (updates every poll).
            $near = PostalCodes::nearest((float) $d->latitude, (float) $d->longitude);

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
                'waypoints' => collect($d->trip_waypoints ?? [])->map(function ($w) use ($geo, $cachedLabels, &$misses) {
                    $lat = (float) ($w['lat'] ?? 0);
                    $lng = (float) ($w['lng'] ?? 0);
                    $near = PostalCodes::nearest($lat, $lng);
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
        if ($misses !== []) {
            BackfillWaypointLabels::dispatch(array_values($misses));
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
    public function update(Request $request, Driver $driver): DriverResource
    {
        $this->authorizeTenant($driver);

        $data = $request->validate([
            'email' => ['nullable', 'email', 'max:255', Rule::unique('drivers', 'email')->ignore($driver->id)],
        ]);

        // PATCH semantics: an ABSENT email leaves the driver untouched, an empty one
        // clears it. Reading $data['email'] unconditionally 500'd on a body that
        // simply didn't carry the field.
        if (array_key_exists('email', $data)) {
            $driver->forceFill(['email' => $data['email'] ?: null])->save();
        }

        return new DriverResource($driver);
    }

    /** Work stats for one driver, computed from our own offers/acceptance data. */
    public function stats(Request $request, Driver $driver, DriverStatsService $stats): JsonResponse
    {
        $this->authorizeTenant($driver);

        // Fleet-day windows (04:00 boundary), $to exclusive.
        $from = $request->filled('from')
            ? FleetDay::startOfDate($request->string('from'))
            : FleetDay::startDaysAgo(30);
        $to = $request->filled('to')
            ? FleetDay::endOfDate($request->string('to'))
            : FleetDay::todayStart()->addDay();

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
            'drivers' => ['required', 'array'],
            'uber_org_uuid' => ['nullable', 'string'],
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
    public function ingestStatuses(Request $request, DriverStatusIngestor $ingestor, SupplierNetworkRecorder $recorder): JsonResponse
    {
        $data = $request->validate([
            'statuses' => ['required', 'array'],
            'statuses.*.driver_uuid' => ['required', 'string'],
            'statuses.*.status' => ['nullable', 'string'],
            'statuses.*.location_updated_at' => ['nullable', 'numeric'], // ms epoch
            'statuses.*.latitude' => ['nullable', 'numeric'],
            'statuses.*.longitude' => ['nullable', 'numeric'],
            'statuses.*.heading' => ['nullable', 'numeric'],
            'statuses.*.waypoints' => ['nullable', 'array'],
        ]);

        $tenantId = (int) $request->user()->tenant_id;
        $recorder->statuses($tenantId, $data['statuses']);
        $result = $ingestor->ingest($tenantId, $data['statuses']);

        // Live dashboard map: nudge the company's channel so it refetches driver
        // positions instantly instead of waiting for its poll. Best-effort.
        rescue(fn () => broadcast(new DriversBroadcast($tenantId)), report: false);

        return response()->json(['data' => $result]);
    }

    /**
     * Server-side on-demand pull (fallback). Often blocked by Uber's datacenter
     * check — the extension path (ingestRoster) is the reliable one.
     */
    public function sync(UberSupplierClient $client, RosterSyncService $roster): JsonResponse
    {
        $session = UberFleetSession::query()
            ->where('status', UberFleetSession::STATUS_ACTIVE)
            ->orderByDesc('updated_at')
            ->first();

        if ($session === null) {
            return response()->json(['data' => ['synced' => 0, 'reason' => 'no_active_session']]);
        }

        $drivers = $client->getDrivers($session);

        if ($drivers === []) {
            return response()->json(['data' => ['synced' => 0, 'reason' => 'uber_unreachable']]);
        }

        $result = $roster->sync((int) $session->tenant_id, $drivers);

        return response()->json(['data' => $result]);
    }
}
