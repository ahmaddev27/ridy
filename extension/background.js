// Reidey background worker — owns cookie access and the POST to Reidey. Content
// scripts (which can't read httpOnly cookies) message it with a detected org
// uuid; it captures the full cookie jar and syncs the session. It only re-sends
// when the session actually changes, so a normal login triggers exactly one sync.
//
// Cross-browser: Firefox exposes `browser.*` (promises), Chrome `chrome.*`
// (promises in MV3). This shim lets one codebase run on both.
const api = globalThis.browser || globalThis["chrome"];

// The backend URL is supplied by the paired dashboard and stored in
// storage.local. Because every fetch below replays the manager's live Uber
// session (cookies) to `${apiUrl}/...`, a malicious apiUrl would exfiltrate
// that session. Lock the destination host to a hardcoded allowlist. reidey.de
// must be https; localhost/127.0.0.1 may be http for local development.
const ALLOWED_API_HOSTS = ["reidey.de", "localhost", "127.0.0.1"];

function isAllowedApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!ALLOWED_API_HOSTS.includes(parsed.hostname)) return false;
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocal) return parsed.protocol === "http:" || parsed.protocol === "https:";
  return parsed.protocol === "https:";
}

/**
 * Read the paired backend URL + token, but only hand back the URL when it
 * passes the allowlist. Centralizes the E1 guard so no caller can POST the
 * captured session to an attacker-controlled host.
 */
async function getPairing(extraKeys = []) {
  const stored = await api.storage.local.get(["apiUrl", "token", ...extraKeys]);
  if (!stored.apiUrl || !stored.token) return { ...stored, ok: false, reason: "not_paired" };
  if (!isAllowedApiUrl(stored.apiUrl)) {
    console.warn("[Reidey bg] blocked non-allowlisted apiUrl:", stored.apiUrl);
    return { ...stored, ok: false, reason: "bad_api_url" };
  }
  return { ...stored, ok: true };
}

/**
 * Tell the backend that Uber rejected our session (a supplier 401/403 — usually
 * after the company changed its Uber password). The backend flags it
 * needs_relink and alerts the manager. Fire-and-forget + deduped server-side, so
 * repeated poll failures don't spam. Only meaningful for a supplier auth failure.
 */
async function reportBrokenSession(status) {
  if (status !== 401 && status !== 403) return;
  const pairing = await getPairing();
  if (!pairing.ok) return;
  try {
    await fetch(`${pairing.apiUrl}/api/v1/fleet-session/report-broken`, {
      method: "POST",
      headers: { authorization: `Bearer ${pairing.token}`, accept: "application/json" },
    });
  } catch {
    /* offline / transient — the daemon and the next poll also detect it */
  }
}

async function readCookies() {
  // Capture exactly the cookies the browser sends to the RAMEN endpoint. A
  // per-URL query returns one correct value per name; getAll({domain}) instead
  // returns the same name from several domains (.uber.com, vsdispatch.uber.com,
  // auth.uber.com), so the daemon sent e.g. three conflicting `jwt-session`
  // values and Uber picked the wrong one -> 302. Matching the browser's own
  // per-URL cookie set fixes the handshake.
  const cookies = await api.cookies.getAll({ url: "https://vsdispatch.uber.com/ramendca/events" });
  return cookies.map((c) => ({ name: c.name, value: c.value }));
}

/**
 * Capture the fleethub.uber.com-scoped cookie set. supplier's roster/status APIs
 * need their own host cookies, which differ from the vsdispatch (RAMEN) set — so
 * the daemon can replay these to poll roster/status 24/7 without a browser open.
 * Kept a SEPARATE jar so it never disturbs the working RAMEN handshake.
 */
async function readSupplierCookies() {
  const cookies = await api.cookies.getAll({ url: "https://fleethub.uber.com/" });
  return cookies.map((c) => ({ name: c.name, value: c.value }));
}

/** A cheap fingerprint so we don't re-POST an unchanged session on every visit. */
function fingerprint(orgUuid, cookies) {
  return orgUuid + "|" + cookies.length + "|" + cookies.map((c) => c.value.length).join(",");
}

/**
 * Find the fleet org uuid from the manager's session without opening any page:
 * hitting fleethub.uber.com while logged in redirects to /orgs/<uuid>/…, and we
 * read that uuid off the final URL. Uses the manager's own IP (real browser), so
 * supplier responds (our server IP is blocked).
 */
async function discoverOrgUuid() {
  try {
    const res = await fetch("https://fleethub.uber.com/", { credentials: "include", redirect: "follow" });
    const m = res.url.match(/\/orgs\/([0-9a-f-]{36})/i);
    console.log("[Reidey bg] discoverOrgUuid: supplier ->", res.url, "org:", m ? m[1] : "(none)");
    return m ? m[1] : null;
  } catch (e) {
    console.warn("[Reidey bg] discoverOrgUuid failed:", e.message);
    return null;
  }
}

/**
 * True once, if the dashboard's connect button fired recently. Consuming it here
 * means only the tab opened BY connect auto-closes — a supplier tab the manager
 * opens later still syncs silently but is left open.
 */
async function consumeConnectIntent() {
  const { connectPending } = await api.storage.local.get(["connectPending"]);
  if (connectPending && Date.now() - connectPending < 600000) {
    await api.storage.local.remove("connectPending");
    return true;
  }
  return false;
}

async function capture(orgUuid, orgName, { manual = false } = {}) {
  const pairing = await getPairing(["lastSync"]);
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { apiUrl, token, lastSync } = pairing;

  // Treat a pending dashboard "Connect" intent as an explicit (manual) capture,
  // so a reconnect from the dashboard clears the backend's autolink block even
  // though it flows through the auto-capture content script.
  if (!manual) {
    const { connectPending } = await api.storage.local.get(["connectPending"]);
    if (connectPending && Date.now() - connectPending < 600000) manual = true;
  }

  console.log("[Reidey bg] capture start — orgUuid:", orgUuid || "(discover)");
  // When connecting from account.uber.com there's no org uuid on the page —
  // discover it from the supplier redirect using the just-established session.
  if (!orgUuid) {
    orgUuid = await discoverOrgUuid();
    if (!orgUuid) return { ok: false, reason: "no_org" }; // not signed in / no fleet yet
  }

  const cookies = await readCookies();
  if (cookies.length === 0) return { ok: false, reason: "no_cookies" };
  const supplierCookies = await readSupplierCookies();
  console.log("[Reidey bg] capture — org:", orgUuid, "ramen cookies:", cookies.length, "supplier cookies:", supplierCookies.length);

  // Fold the supplier jar size into the fingerprint so already-linked managers
  // re-sync once after this update (to backfill the supplier cookies), then stay
  // quiet again while nothing changes.
  const fp = fingerprint(orgUuid, cookies) + "|s" + supplierCookies.length;
  if (!manual && lastSync === fp) {
    // Already synced — but if the manager just pressed connect, still close the tab.
    return { ok: true, reason: "unchanged", closeTab: await consumeConnectIntent() };
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/fleet-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        uber_org_uuid: orgUuid,
        cookies,
        supplier_cookies: supplierCookies.length ? supplierCookies : undefined,
        uber_org_name: orgName || undefined,
        // true only when the manager pressed Connect — lets the backend refuse
        // silent auto-captures after an operator disconnected the fleet.
        manual,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    // Remember the org so the on-demand roster pull (from the dashboard, with no
    // supplier tab open) knows which fleet to query.
    await api.storage.local.set({ lastSync: fp, orgUuid });
    return { ok: true, count: cookies.length, closeTab: await consumeConnectIntent() };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Forward the driver roster (captured from the manager's browser) to Reidey. */
async function postRoster(drivers) {
  const pairing = await getPairing();
  console.log("[Reidey bg] postRoster", { drivers: drivers.length, apiUrl: pairing.apiUrl, hasToken: !!pairing.token });
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { apiUrl, token } = pairing;

  // Tell the backend which Uber org this roster came from, so it can reject a
  // pull that doesn't match the company's own linked fleet.
  const { orgUuid } = await api.storage.local.get(["orgUuid"]);

  try {
    const res = await fetch(`${apiUrl}/api/v1/drivers/roster`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ drivers, uber_org_uuid: orgUuid || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[Reidey bg] roster ingest failed", res.status, body);
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    const body = await res.json();
    console.log("[Reidey bg] roster ingest ok", body.data);
    return { ok: true, ...body.data };
  } catch (e) {
    console.error("[Reidey bg] roster ingest error", e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * Pull the roster straight from fleethub.uber.com using the manager's own
 * cookies and real browser IP (Uber blocks datacenter IPs, so this is the
 * reliable path), then forward it to Reidey. Triggered on demand from the
 * dashboard — no supplier tab needs to be open.
 */
// Uber's supplier getDrivers is a POST that pages through the roster. These are
// the filters the supplier UI itself sends (all empty = "everyone").
// NOTE: `complianceStatusFitler` is misspelled in Uber's OWN API contract — it
// must match their field name verbatim, so do NOT "correct" it.
// TODO(shared-contract): duplicated in dispatch-daemon/src/stream.js
// (ROSTER_FILTERS). This extension ships unbundled (raw MV3 files, no build step)
// and deploys separately from the daemon, so there is no shared module to import
// today. If a bundler is added here, extract this into one shared source.
const ROSTER_FILTERS = {
  documentFilter: [],
  activationFilter: [],
  tripsCountFilter: [],
  tripActivityFilter: [],
  rewardStatusFilter: [],
  onboardingStatusFilter: [],
  complianceStatusFitler: [],
  vehicleAssignmentStatusFilter: [],
  gigUnifiedStatusFilter: [],
  gigBaseTypeFilter: [],
  cityIdFilter: [],
  flowTypeFilter: [],
  driverRoleFilter: [],
  excludeAmdVirtualOperators: true,
  gigTypeOnboardingStatusFilter: [],
  gigTypeDocumentStatusFilter: [],
};

async function fetchRoster() {
  const { orgUuid } = await api.storage.local.get(["orgUuid"]);
  if (!orgUuid) return { ok: false, reason: "no_org_uuid" };

  const rows = [];
  let pageToken = "";
  try {
    for (let page = 1; page <= 100; page++) {
      const res = await fetch("https://fleethub.uber.com/api/getDrivers?localeCode=en-GB", {
        method: "POST",
        credentials: "include",
        headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
        body: JSON.stringify({
          orgUuid: { uuid: { value: orgUuid } },
          driversFilters: ROSTER_FILTERS,
          driverUuids: [],
          paginationOptions: {
            pageSize: { value: 100 },
            pageToken: pageToken ? { value: pageToken } : {},
          },
        }),
      });
      console.log("[Reidey bg] getDrivers page", page, "->", res.status);
      if (!res.ok) {
        await reportBrokenSession(res.status);
        return { ok: false, reason: `supplier_http_${res.status}` };
      }

      const result = await res.json();
      if (result.status !== "success") {
        return { ok: false, reason: result.message || "getdrivers_failed" };
      }
      const data = result.data || {};
      rows.push(...(data.driversData || []));

      const next = data.pageToken || "";
      if (!next || next === pageToken) break;
      pageToken = next;
    }

    console.log("[Reidey bg] getDrivers collected", rows.length, "drivers");
    if (rows.length === 0) return { ok: false, reason: "no_drivers" };

    return await postRoster(rows);
  } catch (e) {
    console.error("[Reidey bg] fetchRoster error", e.message);
    return { ok: false, reason: e.message };
  }
}

// Uber metric names → our normalized fields.
const METRIC_MAP = {
  SUPPLY_METRIC_TOTAL_EARNINGS: "earnings",
  SUPPLY_METRIC_TOTAL_EARNINGS_LABEL: "earnings_label",
  SUPPLY_METRIC_TRIP_COUNT: "trips",
  SUPPLY_METRIC_HOURS_ONLINE: "hours_online",
  SUPPLY_METRIC_HOURS_ON_TRIP: "hours_on_trip",
  SUPPLY_METRIC_ACCEPTANCE_RATE: "acceptance_rate",
  SUPPLY_METRIC_CANCELLATION_RATE: "cancellation_rate",
};
const METRIC_NAMES = Object.keys(METRIC_MAP);

/**
 * Pull one driver's performance metrics from supplier GetEarnerMetrics (using
 * the manager's own session + real IP), normalize them, store on Reidey, and
 * return them to the dashboard. `from`/`to` are ms-epoch.
 */
async function fetchMetrics(driverUuid, from, to) {
  const pairing = await getPairing(["orgUuid"]);
  if (!pairing.orgUuid) return { ok: false, reason: "no_org_uuid" };
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { orgUuid, apiUrl, token } = pairing;

  let uberData;
  try {
    const res = await fetch("https://fleethub.uber.com/api/GetEarnerMetrics?localeCode=en-GB", {
      method: "POST",
      credentials: "include",
      headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
      body: JSON.stringify({
        orgUuid: { value: orgUuid },
        driverUuid: { value: driverUuid },
        timeRange: { startsAt: { value: String(from) }, endsAt: { value: String(to) } },
        metrics: METRIC_NAMES,
      }),
    });
    if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };
    const body = await res.json();
    if (body.status !== "success") return { ok: false, reason: body.message || "metrics_failed" };
    uberData = body.data;
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  // Normalize the metricName/metricValue pairs into flat fields.
  const metrics = { driver_uuid: driverUuid, period_start: from, period_end: to };
  for (const m of uberData?.metrics ?? []) {
    const field = METRIC_MAP[m.metricName];
    if (!field) continue;
    const v = m.metricValue ?? {};
    // Uber nests the value one level deep, e.g. { doubleValue: { value: 4403.89 } }.
    const raw = v.doubleValue ?? v.int64Value ?? v.stringValue ?? null;
    metrics[field] = raw && typeof raw === "object" ? (raw.value ?? null) : raw;
  }

  // Store on Reidey (best-effort — still return to the page if this fails).
  try {
    await fetch(`${apiUrl}/api/v1/drivers/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(metrics),
    });
  } catch (e) {
    console.warn("[Reidey bg] metrics store failed", e.message);
  }

  return { ok: true, metrics };
}

// Uber's supplier SearchVehicles GraphQL query (captured from the fleet UI).
const SEARCH_VEHICLES_QUERY = `query SearchVehicles($orgUUID: String, $filters: SearchVehicleFilters, $withAssignments: Boolean!) {
  SearchSupplierVehicles(orgUUID: $orgUUID, filters: $filters) {
    vehicles { uuid make model year licensePlate vin color colorHexCode imageURL compliance { status } assignments @include(if: $withAssignments) { entityUUID } }
  }
}`;

/**
 * Pull the fleet's vehicles from supplier SearchVehicles (manager's own session
 * + real IP), normalize them, and forward to Reidey. Triggered on demand from
 * the Vehicles page.
 */
async function fetchVehicles() {
  const pairing = await getPairing(["orgUuid"]);
  if (!pairing.orgUuid) return { ok: false, reason: "no_org_uuid" };
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { orgUuid, apiUrl, token } = pairing;

  let vehicles;
  try {
    const res = await fetch("https://fleethub.uber.com/graphql", {
      method: "POST",
      credentials: "include",
      headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
      body: JSON.stringify({
        operationName: "SearchVehicles",
        query: SEARCH_VEHICLES_QUERY,
        variables: { orgUUID: orgUuid, filters: {}, withAssignments: true },
      }),
    });
    if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };
    const body = await res.json();
    vehicles = body?.data?.SearchSupplierVehicles?.vehicles;
    if (!Array.isArray(vehicles)) return { ok: false, reason: body?.errors?.[0]?.message || "no_vehicles" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  const normalized = vehicles.map((v) => ({
    uber_vehicle_uuid: v.uuid,
    make: v.make ?? null,
    model: v.model ?? null,
    year: v.year || null,
    license_plate: v.licensePlate ?? null,
    vin: v.vin ?? null,
    color: v.localizedColorName ?? v.color ?? null,
    color_hex: v.colorHexCode ? "#" + String(v.colorHexCode).replace(/^#/, "") : null,
    image_url: v.imageURL ?? null,
    compliance_status: v.compliance?.status ?? null,
    assigned_driver_uuid: v.assignments?.[0]?.entityUUID ?? null,
  }));

  try {
    const res = await fetch(`${apiUrl}/api/v1/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ vehicles: normalized }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return { ok: false, reason: b.message || `http_${res.status}` };
    }
    const b = await res.json();
    return { ok: true, ...b.data };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Pull live online/offline presence for the given drivers from Uber's supplier
 * GetDriverLiveLocation (bulk), then forward to Reidey. `driverUuids` is an
 * array of Uber driver UUIDs.
 */
async function fetchDriverStatuses(driverUuids) {
  const pairing = await getPairing(["orgUuid"]);
  if (!pairing.orgUuid) return { ok: false, reason: "no_org_uuid" };
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { orgUuid, apiUrl, token } = pairing;
  // An empty list means "everyone" — used by the background poll.
  const ids = Array.isArray(driverUuids) ? driverUuids : [];

  let locations;
  try {
    const res = await fetch("https://fleethub.uber.com/api/GetDriverLiveLocation?localeCode=en-GB", {
      method: "POST",
      credentials: "include",
      headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
      body: JSON.stringify({
        orgId: { uuid: { value: orgUuid } },
        driverIds: ids.map((u) => ({ value: u })),
        filters: { allowedStatuses: [] },
        // No fieldMask → Uber returns coordinates + course + trip waypoints for
        // engaged drivers (idle/offline come back as 0,0), powering the live map.
        responseSelector: { includeStats: true },
      }),
    });
    if (!res.ok) {
      await reportBrokenSession(res.status);
      return { ok: false, reason: `supplier_http_${res.status}` };
    }
    const body = await res.json();
    if (body.status !== "success") return { ok: false, reason: body?.data?.message || "status_failed" };
    locations = body.data?.driverLocations ?? [];
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  const statuses = locations.map((l) => ({
    driver_uuid: l.driverId?.value,
    status: l.driverStatus ?? null,
    location_updated_at: l.locationUpdatedTime?.value ? Number(l.locationUpdatedTime.value) : null,
    latitude: typeof l.latitude === "number" ? l.latitude : null,
    longitude: typeof l.longitude === "number" ? l.longitude : null,
    heading: typeof l.course === "number" ? l.course : null,
    waypoints: Array.isArray(l.waypointsLocation)
      ? l.waypointsLocation.map((w) => ({ lat: w.latitude, lng: w.longitude, type: w.checkpointType }))
      : null,
  })).filter((s) => s.driver_uuid);

  try {
    const res = await fetch(`${apiUrl}/api/v1/drivers/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ statuses }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return { ok: false, reason: b.message || `http_${res.status}` };
    }
    return { ok: true, count: statuses.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Forward RAMEN offers (captured in the manager's browser) to Reidey. */
async function postOffers(offers, seq) {
  const pairing = await getPairing();
  console.log("[Reidey bg] postOffers", { offers: offers.length, apiUrl: pairing.apiUrl, hasToken: !!pairing.token });
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { apiUrl, token } = pairing;

  try {
    const res = await fetch(`${apiUrl}/api/v1/dispatch/offers/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ offers, seq }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[Reidey bg] ingest failed", res.status, body);
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    const body = await res.json();
    console.log("[Reidey bg] ingest ok", body.data);
    return { ok: true, ...body.data };
  } catch (e) {
    console.error("[Reidey bg] ingest error", e.message);
    return { ok: false, reason: e.message };
  }
}

// Forward one passively-captured Uber Fleet API response to Reidey's generic
// supplier-capture sink, tagged with a kind derived from the endpoint. Best
// -effort: a failed capture must never disrupt browsing.
async function postCapture(kind, url, payload) {
  const pairing = await getPairing();
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const { apiUrl, token } = pairing;
  let summary = "";
  try {
    summary = new URL(url).pathname.slice(0, 250);
  } catch {
    summary = String(url || "").slice(0, 250);
  }
  try {
    const res = await fetch(`${apiUrl}/api/v1/supplier/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: String(kind || "api").slice(0, 20), summary, payload }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ── GraphQL replay: re-issue a request the page made earlier, on demand ──────
// The Uber Fleet dashboard fetches earnings/timeline over graphql. We can't build
// those queries ourselves, so inject.js stashes the full request body the FIRST
// time the manager opens the page; here we replay it (with the driver swapped in)
// so the data refreshes without the manager ever reopening the Uber tab.

async function replayGraphql(operationName) {
  const key = `gqltpl:${operationName}`;
  const stored = await api.storage.local.get([key]);
  const tpl = stored[key];
  if (!tpl || !tpl.body) return { ok: false, reason: "no_template" };
  let bodyObj;
  try {
    bodyObj = JSON.parse(tpl.body);
  } catch {
    return { ok: false, reason: "bad_template" };
  }
  const gqlUrl = /^https?:/i.test(tpl.url || "") ? tpl.url : `https://fleethub.uber.com${tpl.url || "/graphql"}`;
  try {
    const res = await fetch(gqlUrl, {
      method: "POST",
      credentials: "include",
      headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };
    return { ok: true, operationName, variables: bodyObj.variables, data: await res.json() };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Refresh the fleet earnings roll-up (getSupplierBreakdownV2) → backend parser. */
async function fetchFleetEarnings() {
  const r = await replayGraphql("getSupplierBreakdownV2");
  if (!r.ok) return r;
  return await postCapture("supplierbreakdownv2", "https://fleethub.uber.com/graphql", {
    operationName: r.operationName,
    variables: r.variables,
    data: r.data,
  });
}

/** On opening a driver: refresh the earnings breakdown (stored, all drivers). */
async function fetchDriverUber() {
  const out = { ok: true };
  const eb = await replayGraphql("getEarnerBreakdownsV2");
  if (eb.ok) {
    await postCapture("earnerbreakdownsv2", "https://fleethub.uber.com/graphql", {
      operationName: eb.operationName,
      variables: eb.variables,
      data: eb.data,
    }).catch(() => {});
    out.breakdown = true;
  }
  return out;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "store_graphql_template" && msg.operationName) {
    api.storage.local
      .set({ [`gqltpl:${msg.operationName}`]: { url: msg.url, body: msg.body, at: Date.now() } })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "fetchFleetEarnings") {
    fetchFleetEarnings().then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchDriverUber") {
    fetchDriverUber(msg.driverUuid).then(sendResponse);
    return true;
  }
  if (msg?.type === "supplier_capture") {
    postCapture(msg.kind, msg.url, msg.payload).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "capture") {
    // orgUuid may be null (account.uber.com) — capture() discovers it in the
    // background. Do NOT gate on it here, or that whole flow never runs.
    capture(msg.orgUuid || null, msg.orgName, { manual: !!msg.manual }).then((res) => {
      console.log("[Reidey bg] capture result:", res);
      sendResponse(res);
      // Close the Uber tab ONLY when this capture belongs to an explicit connect
      // (closeTab set via the dashboard's connect intent). A supplier tab the
      // manager opens themselves syncs silently and is left open.
      const tabId = sender?.tab?.id;
      if (res?.ok && res.closeTab && tabId != null) {
        setTimeout(() => api.tabs?.remove(tabId).catch(() => {}), 2500);
      }
    });
    return true; // async response
  }
  if (msg?.type === "connectIntent") {
    // The dashboard pressed connect — remember it so the next fresh capture's tab
    // auto-closes. Expires after 10 min (see consumeConnectIntent).
    api.storage.local.set({ connectPending: Date.now() }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "roster" && Array.isArray(msg.drivers)) {
    postRoster(msg.drivers).then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchRoster") {
    fetchRoster().then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchMetrics" && msg.driverUuid) {
    fetchMetrics(msg.driverUuid, msg.from, msg.to).then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchVehicles") {
    fetchVehicles().then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchStatuses" && Array.isArray(msg.driverUuids)) {
    fetchDriverStatuses(msg.driverUuids).then(sendResponse);
    return true;
  }
  if (msg?.type === "offers" && Array.isArray(msg.offers)) {
    postOffers(msg.offers, msg.seq).then(sendResponse);
    return true;
  }
});

// ── Background polling (no page needed) ──────────────────────────────────────
// The manager only ever sees the account.uber.com tab at connect time. After
// that, the service worker itself polls Uber (supplier, via the manager's real
// IP) on a timer so driver presence + offer acceptance stay fresh 24/7 without
// opening any tab. chrome.alarms wakes the worker even after it sleeps.
const POLL_ALARM = "ridy-poll";
let pollTick = 0;

async function backgroundPoll() {
  const pairing = await getPairing(["orgUuid"]);
  if (!pairing.ok || !pairing.orgUuid) return; // not connected / bad api url

  // Presence + acceptance every tick (catches ON_TRIP transitions promptly).
  await fetchDriverStatuses([]).catch(() => {});
  // Roster refresh roughly every 30 minutes.
  if (pollTick % 30 === 0) await fetchRoster().catch(() => {});
  pollTick++;
}

api.alarms?.create(POLL_ALARM, { periodInMinutes: 1 });
api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) backgroundPoll();
});
// Also poll right after the worker (re)starts.
backgroundPoll();
