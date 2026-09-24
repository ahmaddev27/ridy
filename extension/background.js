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
const ALLOWED_API_HOSTS = ["reidey.de"];

// Pages allowed to (un)pair the extension. Keep in sync with pair.js; both lines
// are toggled by dev-hosts.mjs and checked by check-release.mjs.
const ALLOWED_PAIR_ORIGINS = ["https://reidey.de"];

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

/** Hostname of a URL, or "" when it does not parse. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const FLEET_UI_HOST = /^(supplier|fleethub)\.uber\.com$/i;
const DISPATCH_HOST = /^vsdispatch\.uber\.com$/i;

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

// ── Org-bound local state ───────────────────────────────────────────────────
// The stored org uuid and the GraphQL replay templates belong to ONE Uber fleet.
// Whenever the pairing moves to another company, or the backend says the org is
// not this company's, all of it must go — otherwise company A's live GPS,
// vehicles and earnings would be posted into company B.
const TEMPLATE_PREFIX = "gqltpl:";

/**
 * Forget the stored org and its replay templates. `keepOrg` spares templates
 * already captured for that org (a Connect page may stash them before its own
 * capture completes).
 */
async function clearOrgState(keepOrg = null) {
  const all = await api.storage.local.get(null);
  const templateKeys = Object.keys(all || {}).filter((k) => {
    if (!k.startsWith(TEMPLATE_PREFIX)) return false;
    if (!keepOrg) return true;
    const parsed = parseReplayBody(k.slice(TEMPLATE_PREFIX.length), all[k]?.body);
    return !parsed || templateOrg(parsed.variables) !== keepOrg;
  });
  await api.storage.local.remove(["orgUuid", "lastSync", "lastRosterAt", ...templateKeys]);
}

/** Everything the extension keeps about a pairing, for a full unpair. */
async function clearPairing() {
  await clearOrgState();
  await api.storage.local.remove(["apiUrl", "token", "connectPending", "backendPause"]);
}

// ── Backend calls ───────────────────────────────────────────────────────────
// Every call to Reidey goes through backendFetch so an auth or state rejection
// is handled once: a 401 (token revoked/expired) unpairs locally — the dashboard
// then sees paired:false and silently re-pairs — and a 403/409/429 pauses the
// minute poll instead of hammering Uber and the backend with no chance of success.
const BACKEND_PAUSE_MS = 15 * 60 * 1000;
const DEFAULT_RETRY_AFTER_S = 60;

async function pauseBackend(ms, reason) {
  await api.storage.local.set({ backendPause: { until: Date.now() + ms, reason } });
}

function retryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  const seconds = Number(raw);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_S) * 1000;
}

/**
 * React to a backend rejection. Returns the normalized reason for the caller.
 * `orgUuid` is the org the rejected request was about (when known); `usedToken`
 * is the token the rejected request was sent with.
 */
async function handleBackendRejection(res, body, orgUuid, usedToken) {
  const message = typeof body?.message === "string" ? body.message : "";
  if (res.status === 401) {
    // Only unpair when the REJECTED token is still the stored one: a request that
    // was in flight on the old token while the dashboard re-paired must not delete
    // the fresh token (the Connect capture would then fail with not_paired).
    const { token: current } = await api.storage.local.get(["token"]);
    // Keep apiUrl so the dashboard's silent re-pair works right away.
    if (current === usedToken) await api.storage.local.remove(["token", "lastSync"]);
    return "unpaired";
  }
  if (res.status === 409 && message === "org_mismatch") {
    await clearOrgState();
    return message;
  }
  if (res.status === 409 && message === "uber_org_already_linked") {
    // This browser's Uber org belongs to another company. Drop it only if it is
    // what we had stored; the stored org may still be this company's own.
    const { orgUuid: stored } = await api.storage.local.get(["orgUuid"]);
    if (orgUuid && stored === orgUuid) await clearOrgState();
    return message;
  }
  if (res.status === 403 || res.status === 409) {
    await pauseBackend(BACKEND_PAUSE_MS, message || `http_${res.status}`);
  } else if (res.status === 429) {
    await pauseBackend(retryAfterMs(res), "rate_limited");
  }
  return message || `http_${res.status}`;
}

/**
 * POST JSON to the paired backend. Resolves to
 * { ok, status, data, reason } and never throws.
 */
async function backendFetch(pairing, path, payload, { orgUuid = null, method = "POST" } = {}) {
  let res;
  try {
    res = await fetch(`${pairing.apiUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${pairing.token}`,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || "network_error" };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, status: res.status, body, data: body?.data };
  const reason = await handleBackendRejection(res, body, orgUuid, pairing.token);
  console.warn("[Reidey bg] backend", path, "->", res.status, reason);
  return { ok: false, status: res.status, reason, body };
}

/** True while a backend 403/409/429 asked us to back off. */
async function backendPaused() {
  const { backendPause } = await api.storage.local.get(["backendPause"]);
  return !!(backendPause && typeof backendPause.until === "number" && backendPause.until > Date.now());
}

/**
 * Tell the backend that Uber rejected our session (a supplier 401/403 — usually
 * after the company changed its Uber password). The backend flags it
 * needs_relink and alerts the manager. Fire-and-forget + deduped server-side, so
 * repeated poll failures don't spam. Only meaningful for a supplier auth failure.
 */
async function reportBrokenSession(status) {
  if (status !== 401 && status !== 403) return;
  // The next Uber page visit must re-capture even if the cookie set looks the same.
  await api.storage.local.remove("lastSync");
  const pairing = await getPairing();
  if (!pairing.ok) return;
  await backendFetch(pairing, "/api/v1/fleet-session/report-broken", undefined);
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

// Cookies that identify the Uber login itself. Their VALUE changes on a new
// sign-in (other account, password change, logout/login), which a length-only
// fingerprint could miss. Short-lived tokens (jwt-session, csrf, analytics)
// rotate on their own and are deliberately NOT hashed by value: re-posting on
// every such rotation would restart the daemon's offer stream each page load.
const SESSION_IDENTITY_COOKIES = /^(sid|csid)$/i;

function jarSignature(cookies) {
  return [...cookies]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => (SESSION_IDENTITY_COOKIES.test(c.name) ? `${c.name}=${c.value}` : `${c.name}#${String(c.value).length}`))
    .join(";");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fingerprint of the session so an unchanged one is not re-POSTed on every
 * visit. Only a hash is stored, never a second plaintext copy of a cookie.
 */
async function fingerprint(orgUuid, cookies, supplierCookies = []) {
  return "v2:" + (await sha256Hex(`${orgUuid}\n${jarSignature(cookies)}\n${jarSignature(supplierCookies)}`));
}

// A null discovery is cached briefly so several Uber tabs (or a login page's
// retry loop) do not each fire their own credentialed fleethub fetch.
const DISCOVERY_NULL_COOLDOWN_MS = 20000;
let lastNullDiscoveryAt = 0;

/**
 * Find the fleet org uuid from the manager's session without opening any page:
 * hitting fleethub.uber.com while logged in redirects to /orgs/<uuid>/…, and we
 * read that uuid off the final URL. Uses the manager's own IP (real browser), so
 * supplier responds (our server IP is blocked).
 */
async function discoverOrgUuid({ force = false } = {}) {
  if (!force && Date.now() - lastNullDiscoveryAt < DISCOVERY_NULL_COOLDOWN_MS) return null;
  try {
    const res = await fetch("https://fleethub.uber.com/", { credentials: "include", redirect: "follow" });
    const m = res.url.match(/\/orgs\/([0-9a-f-]{36})/i);
    console.log("[Reidey bg] discoverOrgUuid: supplier ->", res.url, "org:", m ? m[1] : "(none)");
    if (!m) lastNullDiscoveryAt = Date.now();
    return m ? m[1] : null;
  } catch (e) {
    console.warn("[Reidey bg] discoverOrgUuid failed:", e.message);
    lastNullDiscoveryAt = Date.now();
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
  const { lastSync } = pairing;

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
    orgUuid = await discoverOrgUuid({ force: manual });
    if (!orgUuid) return { ok: false, reason: "no_org" }; // not signed in / no fleet yet
  }

  const cookies = await readCookies();
  if (cookies.length === 0) return { ok: false, reason: "no_cookies" };
  const supplierCookies = await readSupplierCookies();
  console.log("[Reidey bg] capture — org:", orgUuid, "ramen cookies:", cookies.length, "supplier cookies:", supplierCookies.length);

  const fp = await fingerprint(orgUuid, cookies, supplierCookies);
  if (!manual && lastSync === fp) {
    // Already synced — but if the manager just pressed connect, still close the tab.
    return { ok: true, reason: "unchanged", closeTab: await consumeConnectIntent() };
  }

  const res = await backendFetch(
    pairing,
    "/api/v1/fleet-session",
    {
      uber_org_uuid: orgUuid,
      cookies,
      supplier_cookies: supplierCookies.length ? supplierCookies : undefined,
      uber_org_name: orgName || undefined,
      // true only when the manager pressed Connect — lets the backend refuse
      // silent auto-captures after an operator disconnected the fleet.
      manual,
    },
    { orgUuid },
  );
  if (!res.ok) return { ok: false, reason: res.reason, status: res.status };

  // 202 {status:'blocked'}: the operator disconnected this company and only an
  // explicit Connect may relink it. Nothing was stored — stop polling for it.
  if (res.status === 202 && res.data?.status === "blocked") {
    await clearOrgState();
    return { ok: false, reason: "autolink_blocked", blocked: true };
  }

  // Remember the org so the on-demand roster pull (from the dashboard, with no
  // supplier tab open) knows which fleet to query. A capture the backend accepted
  // also lifts any earlier poll pause (e.g. 409 not_connected before a reconnect).
  const { orgUuid: previousOrg } = await api.storage.local.get(["orgUuid"]);
  if (previousOrg && previousOrg !== orgUuid) await clearOrgState(orgUuid);
  await api.storage.local.set({ lastSync: fp, orgUuid });
  await api.storage.local.remove("backendPause");
  return { ok: true, count: cookies.length, closeTab: await consumeConnectIntent() };
}

/** Forward the driver roster (captured from the manager's browser) to Reidey. */
async function postRoster(drivers) {
  const pairing = await getPairing(["orgUuid"]);
  console.log("[Reidey bg] postRoster", { drivers: drivers.length, apiUrl: pairing.apiUrl, hasToken: !!pairing.token });
  if (!pairing.ok) return { ok: false, reason: pairing.reason };

  // Tell the backend which Uber org this roster came from, so it can reject a
  // pull that doesn't match the company's own linked fleet.
  const orgUuid = pairing.orgUuid || undefined;
  const res = await backendFetch(pairing, "/api/v1/drivers/roster", { drivers, uber_org_uuid: orgUuid }, { orgUuid });
  if (!res.ok) return { ok: false, reason: res.reason };
  console.log("[Reidey bg] roster ingest ok", res.data);
  return { ok: true, ...res.data };
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
  await api.storage.local.set({ lastRosterAt: Date.now() });

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
  const { orgUuid } = pairing;

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
  const stored = await backendFetch(pairing, "/api/v1/drivers/metrics", { ...metrics, uber_org_uuid: orgUuid }, { orgUuid });
  if (!stored.ok) console.warn("[Reidey bg] metrics store failed", stored.reason);

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
  const { orgUuid } = pairing;

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

  const res = await backendFetch(pairing, "/api/v1/vehicles", { vehicles: normalized, uber_org_uuid: orgUuid }, { orgUuid });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, ...res.data };
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
  const { orgUuid } = pairing;
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

  const res = await backendFetch(pairing, "/api/v1/drivers/statuses", { statuses, uber_org_uuid: orgUuid }, { orgUuid });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, count: statuses.length };
}

/** Forward RAMEN offers (captured in the manager's browser) to Reidey. */
async function postOffers(offers, seq) {
  const pairing = await getPairing(["orgUuid"]);
  console.log("[Reidey bg] postOffers", { offers: offers.length, apiUrl: pairing.apiUrl, hasToken: !!pairing.token });
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const orgUuid = pairing.orgUuid || undefined;

  const res = await backendFetch(pairing, "/api/v1/dispatch/offers/ingest", { offers, seq, uber_org_uuid: orgUuid }, { orgUuid });
  if (!res.ok) return { ok: false, reason: res.reason };
  console.log("[Reidey bg] ingest ok", res.data);
  return { ok: true, ...res.data };
}

// Forward one passively-captured Uber Fleet API response to Reidey's generic
// supplier-capture sink, tagged with a kind derived from the endpoint. Best
// -effort: a failed capture must never disrupt browsing.
async function postCapture(kind, url, payload) {
  const pairing = await getPairing(["orgUuid"]);
  if (!pairing.ok) return { ok: false, reason: pairing.reason };
  const orgUuid = pairing.orgUuid || undefined;
  let summary = "";
  try {
    summary = new URL(url).pathname.slice(0, 250);
  } catch {
    summary = String(url || "").slice(0, 250);
  }
  const res = await backendFetch(
    pairing,
    "/api/v1/supplier/capture",
    { kind: String(kind || "api").slice(0, 20), summary, payload, uber_org_uuid: orgUuid },
    { orgUuid },
  );
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

// ── Page-world input validation ─────────────────────────────────────────────
// inject.js runs in the Uber page's MAIN world, where any other script (Uber's
// third-party JS, an XSS, another extension) can post the same messages. So the
// DSGVO allowlist and the shape checks are enforced again here, where the page
// cannot reach. Keep in sync with inject.js CAPTURE_ALLOWLIST / REPLAY_TARGETS.
const CAPTURE_ALLOWLIST = [
  /getDrivers\b/i,
  /GetEarnerMetrics\b/i,
  /GetDriverLiveLocation\b/i,
  /SearchVehicles\b/i,
  /getEarnerBreakdowns/i,
  /getSupplierBreakdown/i,
  /\bearnings\b/i,
];
const REPLAY_TARGETS = ["getEarnerBreakdownsV2", "getSupplierBreakdownV2"];
const MAX_TEMPLATE_BYTES = 64 * 1024;
const MAX_OFFERS_PER_FRAME = 50;

/** Is this capture one of the allowlisted endpoints (path or graphql op)? */
function isAllowedCapture(url, payload) {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!/(\/api\/|\/graphql)/i.test(path)) return false;
  const op = payload && typeof payload === "object" && typeof payload.operationName === "string" ? payload.operationName : null;
  const subject = /graphql/i.test(path) ? op : path;
  return typeof subject === "string" && CAPTURE_ALLOWLIST.some((re) => re.test(subject));
}

/**
 * Parse + validate a GraphQL replay body: it must name one of the replay
 * targets and be a read-only query. Returns the parsed object, or null.
 */
function parseReplayBody(operationName, body) {
  if (!REPLAY_TARGETS.includes(operationName)) return null;
  if (typeof body !== "string" || body.length === 0 || body.length > MAX_TEMPLATE_BYTES) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.operationName !== operationName) return null;
  if (parsed.query !== undefined) {
    if (typeof parsed.query !== "string") return null;
    if (!/^\s*query\b/.test(parsed.query) || /\b(mutation|subscription)\b/.test(parsed.query)) return null;
  } else if (!parsed.extensions?.persistedQuery) {
    return null; // neither a query nor a persisted-query hash
  }
  return parsed;
}

/** Validate and store a template the page sent. Returns true when stored. */
async function storeGraphqlTemplate(msg, sender) {
  const host = hostOf(sender?.url || sender?.tab?.url || "");
  if (!FLEET_UI_HOST.test(host)) return false;
  if (!parseReplayBody(msg.operationName, msg.body)) return false;
  await api.storage.local.set({
    [`${TEMPLATE_PREFIX}${msg.operationName}`]: { body: msg.body, host, at: Date.now() },
  });
  return true;
}

/** Plain JSON objects only — what a real RAMEN offer frame contains. */
function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function validOffers(offers) {
  return Array.isArray(offers) && offers.length > 0 && offers.length <= MAX_OFFERS_PER_FRAME && offers.every(isPlainObject);
}

// ── Fleet week (Europe/Berlin, Monday 04:00) ────────────────────────────────
const FLEET_TZ = "Europe/Berlin";
const FLEET_DAY_START_HOUR = 4;
const DAY_MS = 24 * 3600 * 1000;

let berlinFormatter = null;

/** Europe/Berlin UTC offset (ms) at an instant — DST-correct via Intl. */
function berlinOffsetMs(epochMs) {
  berlinFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: FLEET_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of berlinFormatter.formatToParts(new Date(epochMs))) parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Epoch ms of a Berlin wall-clock time (month 0-based; day may overflow). */
function berlinWallToEpoch(year, month, day, hour) {
  const guess = Date.UTC(year, month, day, hour);
  const first = guess - berlinOffsetMs(guess);
  return guess - berlinOffsetMs(first);
}

/** The current fleet week: Monday 04:00 Berlin → next Monday 04:00 Berlin. */
function currentFleetWeek(nowMs = Date.now()) {
  // Shift the Berlin wall clock back by the fleet-day start so 04:00 reads as
  // midnight, then find that fleet-day's Monday.
  const wall = new Date(nowMs + berlinOffsetMs(nowMs) - FLEET_DAY_START_HOUR * 3600 * 1000);
  const sinceMonday = (wall.getUTCDay() + 6) % 7;
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  const d = wall.getUTCDate() - sinceMonday;
  return {
    start: berlinWallToEpoch(y, m, d, FLEET_DAY_START_HOUR),
    end: berlinWallToEpoch(y, m, d + 7, FLEET_DAY_START_HOUR),
  };
}

/**
 * A replayed template carries the period the manager last viewed on Fleet Hub.
 * Move it to the current fleet week so a refresh never re-fetches an old week
 * and stamps it as fresh. A full-week template keeps a full-week window; a
 * shorter one runs from the week start up to now. Keeps the original value type.
 */
function withCurrentPeriod(variables, nowMs = Date.now()) {
  const tr = variables?.timeRange;
  if (!tr || typeof tr !== "object") return variables;
  const start = Number(tr.startTimeUnixMillis);
  const end = Number(tr.endTimeUnixMillis);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return variables;

  const week = currentFleetWeek(nowMs);
  const newEnd = end - start >= 6.5 * DAY_MS ? week.end : nowMs;
  const asOriginal = (value, original) => (typeof original === "string" ? String(value) : value);
  return {
    ...variables,
    timeRange: {
      ...tr,
      startTimeUnixMillis: asOriginal(week.start, tr.startTimeUnixMillis),
      endTimeUnixMillis: asOriginal(newEnd, tr.endTimeUnixMillis),
    },
  };
}

/** The org a template's variables are scoped to, if it names one. */
function templateOrg(variables) {
  const org = variables?.orgUUID ?? variables?.orgUuid;
  return typeof org === "string" ? org : null;
}

// ── GraphQL replay: re-issue a request the page made earlier, on demand ──────
// The Uber Fleet dashboard fetches earnings over graphql. We can't build those
// queries ourselves, so inject.js stashes the full request body the FIRST time
// the manager opens the page; here we replay it — moved to the current fleet
// week — so the data refreshes without the manager ever reopening the Uber tab.

async function replayGraphql(operationName) {
  const key = `${TEMPLATE_PREFIX}${operationName}`;
  const stored = await api.storage.local.get([key, "orgUuid"]);
  const tpl = stored[key];
  if (!tpl || !tpl.body) return { ok: false, reason: "no_template" };
  const bodyObj = parseReplayBody(operationName, tpl.body);
  if (!bodyObj) {
    await api.storage.local.remove(key);
    return { ok: false, reason: "bad_template" };
  }
  // A template captured on another company's Fleet Hub must never be replayed.
  const org = templateOrg(bodyObj.variables);
  if (org && org !== stored.orgUuid) {
    await api.storage.local.remove(key);
    return { ok: false, reason: "template_org_mismatch" };
  }

  // Fixed allowlisted origin; templates from older versions stored a page URL,
  // which is only honoured when it points at one of the two fleet hosts.
  const host = tpl.host || hostOf(tpl.url || "");
  const origin = host === "supplier.uber.com" ? "https://supplier.uber.com" : "https://fleethub.uber.com";
  const variables = withCurrentPeriod(bodyObj.variables);
  try {
    const res = await fetch(`${origin}/graphql`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
      body: JSON.stringify({ ...bodyObj, variables }),
    });
    if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };
    return { ok: true, operationName, variables, data: await res.json() };
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

/**
 * On opening a driver: refresh the fleet-wide earnings breakdown (one query
 * covers every driver of the current week, so no per-driver variant exists).
 */
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

// ── Tab closes that survive a worker eviction ───────────────────────────────
// An MV3 worker is killed after ~30s idle, taking any setTimeout with it — so a
// 90s warm-up close would never run and the tab lingered. Each close is also
// persisted and swept by an alarm; the timer stays as the fast path.
const TAB_CLOSE_ALARM = "ridy-tabclose";
let tabCloseQueue = Promise.resolve();

/** Serialize read-modify-write of the pending list (several arms run at once). */
function withTabCloseLock(fn) {
  const run = tabCloseQueue.then(fn, fn);
  tabCloseQueue = run.catch(() => {});
  return run;
}

async function closeTabIfExpected(tabId, host) {
  try {
    const tab = await api.tabs.get(tabId);
    // Tab ids can be reused after a browser restart — never close someone else's tab.
    if (host && hostOf(tab?.url || tab?.pendingUrl || "") !== host) return;
    await api.tabs.remove(tabId);
  } catch {
    /* already closed */
  }
}

function scheduleTabClose(tabId, delayMs, host = null) {
  if (tabId == null) return;
  const closeAt = Date.now() + delayMs;
  withTabCloseLock(async () => {
    const { pendingTabCloses = [] } = await api.storage.local.get(["pendingTabCloses"]);
    pendingTabCloses.push({ tabId, closeAt, host });
    await api.storage.local.set({ pendingTabCloses });
    api.alarms?.create(TAB_CLOSE_ALARM, { when: Math.max(closeAt, Date.now() + 30000) });
  }).catch(() => {});
  setTimeout(() => sweepPendingTabCloses(), delayMs + 50);
}

function sweepPendingTabCloses() {
  return withTabCloseLock(async () => {
    const { pendingTabCloses = [] } = await api.storage.local.get(["pendingTabCloses"]);
    if (pendingTabCloses.length === 0) return;
    const now = Date.now();
    const due = pendingTabCloses.filter((p) => p.closeAt <= now);
    const later = pendingTabCloses.filter((p) => p.closeAt > now);
    for (const p of due) await closeTabIfExpected(p.tabId, p.host);
    await api.storage.local.set({ pendingTabCloses: later });
    if (later.length > 0) {
      const next = Math.min(...later.map((p) => p.closeAt));
      api.alarms?.create(TAB_CLOSE_ALARM, { when: Math.max(next, Date.now() + 30000) });
    }
  }).catch(() => {});
}

// ── Evict the operator's OTHER Uber sessions (opt-in) ───────────────────────
// When the manager has explicitly opted in and just Connected, we open Uber's
// OWN account devices page in a background tab and arm the content script there
// to click Uber's real "sign out all OTHER devices" control. Uber then runs its
// Arkose bot-defense transparently (no forged tokens, no raw endpoint call), and
// the CURRENT session — this browser plus the cookies the daemon replays — is
// preserved by design, since the button evicts everything EXCEPT current.
const EVICT_DEVICES_URL = "https://account.uber.com/devices";
const ACCOUNT_HOST = "account.uber.com";

/** Open the devices page and arm the click. Consumed by content.js on load. */
async function armEviction() {
  try {
    const tab = await api.tabs.create({ url: EVICT_DEVICES_URL, active: false });
    await api.storage.local.set({ evictArmed: { at: Date.now() }, evictTabId: tab?.id ?? null });
    console.log("[Reidey bg] eviction armed — opened devices tab", tab?.id);
    // Guaranteed fallback close: finishEviction closes it 2s after the content
    // script reports, but if that report never comes (page didn't load, the arm
    // went stale, no sign-out button) the tab would linger — so always close it.
    scheduleTabClose(tab?.id, 30000, ACCOUNT_HOST);
    return { ok: true };
  } catch (e) {
    console.warn("[Reidey bg] armEviction failed:", e.message);
    return { ok: false, reason: e.message };
  }
}

// ── Remove a competitor's Linux/server passkey after Connect ────────────────
// A rival that linked the operator's Uber account can register a passkey to log
// back in even after we sign out its sessions. Open the passkeys page and let the
// content script delete ONLY headless/Linux/server passkeys (never the operator's
// own phone/PC). Same "click Uber's own UI" approach as the session eviction — no
// forged requests. Deletes nothing when no such passkey exists.
const PASSKEYS_URL = "https://account.uber.com/passkeys";

async function armPasskeyCleanup() {
  try {
    const tab = await api.tabs.create({ url: PASSKEYS_URL, active: false });
    await api.storage.local.set({ passkeyCleanupArmed: { at: Date.now() }, passkeyTabId: tab?.id ?? null });
    console.log("[Reidey bg] passkey cleanup armed — opened passkeys tab", tab?.id);
    // Fallback close in case the content script never reports (list never rendered).
    scheduleTabClose(tab?.id, 30000, ACCOUNT_HOST);
    return { ok: true };
  } catch (e) {
    console.warn("[Reidey bg] armPasskeyCleanup failed:", e.message);
    return { ok: false, reason: e.message };
  }
}

/** Close the passkeys tab once the content script reports what it removed. */
async function finishPasskeyCleanup(result) {
  const { passkeyTabId } = await api.storage.local.get(["passkeyTabId"]);
  await api.storage.local.remove(["passkeyCleanupArmed", "passkeyTabId"]);
  const deleted = result?.deleted || [];
  const failed = result?.failed || [];
  console.log("[Reidey bg] passkey cleanup:", deleted.length ? `removed ${deleted.join(", ")}` : "nothing removed");
  if (failed.length) console.warn("[Reidey bg] passkey cleanup: nicht entfernt:", failed.join(", "));
  scheduleTabClose(passkeyTabId, 2000, ACCOUNT_HOST);
}

/** Close the devices tab once the content script reports it clicked (or gave up). */
async function finishEviction(result) {
  const { evictTabId } = await api.storage.local.get(["evictTabId"]);
  await api.storage.local.remove(["evictArmed", "evictTabId"]);
  console.log("[Reidey bg] eviction result:", result?.ok ? result?.reason || "confirmed" : result?.reason || "failed");
  // Small delay so Uber's own request finishes before the tab is torn down.
  scheduleTabClose(evictTabId, 2000, ACCOUNT_HOST);
}

/** Always evict the operator's other Uber sessions after a genuine Connect. */
async function armEvictionAfterConnect() {
  await armEviction();
}

// ── Warm up the offer stream right after Connect ────────────────────────────
// The Connect flow lands the manager on fleethub.uber.com, which captures the
// session but does NOT tee offers — the RAMEN offer tap only runs on
// vsdispatch.uber.com (see content.js / inject.js). So on a brand-new company
// the manager saw no offers until they opened the dispatch page THEMSELVES.
// After a genuine Connect we open vsdispatch in a BACKGROUND tab: its content
// script (a) re-captures with fresh vsdispatch-scoped RAMEN cookies (so the
// server-side daemon streams reliably from the first moment), and (b) tees
// offers immediately, covering the ≤60s gap before the daemon picks up the new
// session. We close the tab after that warm-up window — the daemon carries the
// stream from then on, so we don't leave a tab the manager didn't open.
const DISPATCH_WARMUP_URL = "https://vsdispatch.uber.com/";
const DISPATCH_WARMUP_MS = 90000;

async function warmUpDispatchStream() {
  try {
    const tab = await api.tabs.create({ url: DISPATCH_WARMUP_URL, active: false });
    console.log("[Reidey bg] dispatch warm-up tab opened", tab?.id);
    scheduleTabClose(tab?.id, DISPATCH_WARMUP_MS, "vsdispatch.uber.com");
  } catch (e) {
    console.warn("[Reidey bg] warmUpDispatchStream failed:", e.message);
  }
}

// Pull the rest of the fleet's data right after Connect — ALL HEADLESS, no Uber
// tab. Vehicles + roster fetch straight from the supplier API with the captured
// cookies (so the dashboard is populated immediately instead of waiting up to a
// minute for the daemon's first poll). Earnings is different: it REPLAYS the
// graphql template that inject.js captured while the fleethub Connect page was
// loading, so from now on it refreshes every time WITHOUT reopening Uber.
async function syncFleetDataAfterConnect() {
  const results = await Promise.allSettled([fetchVehicles(), fetchRoster()]);
  console.log("[Reidey bg] post-connect sync (vehicles, roster):", results.map((r) => r.status));

  // The fleethub page fires the earnings query a moment AFTER load, so give the
  // template a beat to land, then replay it best-effort. A miss self-heals: the
  // dashboard's normal refresh replays it again once the template is stored.
  setTimeout(() => {
    fetchFleetEarnings().then((r) => console.log("[Reidey bg] earnings sync:", r?.ok ? "ok" : r?.reason));
  }, 6000);
}

// ── Pairing ─────────────────────────────────────────────────────────────────

/** Is the message from an extension page (popup) or an allowed dashboard origin? */
function isTrustedPairingSender(sender) {
  const url = sender?.url || "";
  if (url.startsWith(api.runtime.getURL(""))) return true;
  try {
    return ALLOWED_PAIR_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Ask the backend which Uber org this token's company is bound to. Returns the
 * org uuid, null when the company has none, or undefined when it can't tell.
 */
async function pairedCompanyOrg(pairing) {
  try {
    const res = await fetch(`${pairing.apiUrl}/api/v1/fleet-session`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${pairing.token}` },
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    return typeof body?.data?.uber_org_uuid === "string" ? body.data.uber_org_uuid : null;
  } catch {
    return undefined;
  }
}

/**
 * Store a pairing handed over by the dashboard. When it points at another
 * backend or a new token, the org-bound state is kept only if the backend
 * confirms the stored org is this company's own fleet.
 */
async function applyPairing(apiUrl, token) {
  if (!isAllowedApiUrl(apiUrl) || typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "bad_pairing" };
  }
  const previous = await api.storage.local.get(["apiUrl", "token", "orgUuid"]);
  await api.storage.local.set({ apiUrl, token, lastSync: null }); // force a fresh capture
  await api.storage.local.remove("backendPause");

  const changed = previous.apiUrl !== apiUrl || previous.token !== token;
  if (!changed) return { ok: true };
  if (!previous.orgUuid) {
    await clearOrgState();
    return { ok: true };
  }
  const companyOrg = previous.apiUrl === apiUrl ? await pairedCompanyOrg({ apiUrl, token }) : undefined;
  if (companyOrg === previous.orgUuid) return { ok: true };
  // Only drop what we checked: a capture that finished meanwhile set a new org.
  const { orgUuid: current } = await api.storage.local.get(["orgUuid"]);
  if (current === previous.orgUuid) await clearOrgState();
  return { ok: true };
}

// ── Message router ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own content scripts and pages may drive the worker.
  if (sender?.id !== api.runtime.id) return;

  if (msg?.type === "store_graphql_template" && msg.operationName) {
    storeGraphqlTemplate(msg, sender)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "fetchFleetEarnings") {
    fetchFleetEarnings().then(sendResponse);
    return true;
  }
  if (msg?.type === "fetchDriverUber") {
    fetchDriverUber().then(sendResponse);
    return true;
  }
  if (msg?.type === "supplier_capture") {
    const fromFleetUi = FLEET_UI_HOST.test(hostOf(sender?.url || sender?.tab?.url || ""));
    if (!fromFleetUi || !isAllowedCapture(msg.url, msg.payload)) {
      sendResponse({ ok: false, reason: "not_allowed" });
      return;
    }
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
        scheduleTabClose(tabId, 2500, hostOf(sender?.tab?.url || ""));
      }
      // A genuine dashboard "Connect" just completed (closeTab is one-shot via
      // consumeConnectIntent, so the warm-up tab's own capture won't re-trigger
      // these): evict the operator's other sessions, and warm up the offer stream
      // so offers flow immediately instead of only after the manager opens the
      // dispatch page themselves.
      if (res?.ok && res.closeTab) {
        armEvictionAfterConnect();
        armPasskeyCleanup();
        warmUpDispatchStream();
        syncFleetDataAfterConnect();
      }
    });
    return true; // async response
  }
  if (msg?.type === "evictSessions") {
    // Explicit trigger from the popup after a manual Connect + opt-in.
    armEviction().then(sendResponse);
    return true;
  }
  if (msg?.type === "evictResult") {
    finishEviction(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "passkeyResult") {
    finishPasskeyCleanup(msg).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "connectIntent") {
    // The dashboard pressed connect — remember it so the next fresh capture's tab
    // auto-closes. Expires after 10 min (see consumeConnectIntent).
    api.storage.local.set({ connectPending: Date.now() }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "pair") {
    if (!isTrustedPairingSender(sender)) return;
    applyPairing(String(msg.apiUrl || "").replace(/\/$/, ""), msg.token)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: e?.message || "pair_failed" }));
    return true;
  }
  if (msg?.type === "unpair") {
    if (!isTrustedPairingSender(sender)) return;
    clearPairing()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, reason: e?.message || "unpair_failed" }));
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
  if (msg?.type === "offers") {
    const fromDispatch = DISPATCH_HOST.test(hostOf(sender?.url || sender?.tab?.url || ""));
    if (!fromDispatch || !validOffers(msg.offers)) {
      sendResponse({ ok: false, reason: "not_allowed" });
      return;
    }
    postOffers(msg.offers, msg.seq).then(sendResponse);
    return true;
  }
});

// ── Background polling (no page needed) ──────────────────────────────────────
// The manager only ever sees the account.uber.com tab at connect time. After
// that, the service worker itself polls Uber (supplier, via the manager's real
// IP) on a timer so driver presence + offer acceptance stay fresh 24/7 without
// opening any tab. chrome.alarms wakes the worker even after it sleeps.
//
// The worker is cold-started on nearly every alarm, so nothing here may live in
// memory only: the roster cadence and the "just polled" dedupe are persisted.
const POLL_ALARM = "ridy-poll";
const ROSTER_INTERVAL_MS = 30 * 60 * 1000;
const MIN_POLL_GAP_MS = 50 * 1000;
let pollInFlight = null;

function pollStore() {
  return api.storage.session || api.storage.local;
}

async function runBackgroundPoll() {
  const pairing = await getPairing(["orgUuid", "lastRosterAt"]);
  if (!pairing.ok || !pairing.orgUuid) return; // not connected / bad api url
  if (await backendPaused()) return; // the backend refused us recently — don't hit Uber for nothing

  // Dedupe across worker restarts (a wake-up fires several events at once).
  const store = pollStore();
  const { lastPollAt } = await store.get(["lastPollAt"]);
  if (typeof lastPollAt === "number" && Date.now() - lastPollAt < MIN_POLL_GAP_MS) return;
  await store.set({ lastPollAt: Date.now() });

  // Presence + acceptance every tick (catches ON_TRIP transitions promptly).
  await fetchDriverStatuses([]).catch(() => {});

  // Roster refresh every 30 minutes (fetchRoster stamps lastRosterAt up front).
  const lastRosterAt = typeof pairing.lastRosterAt === "number" ? pairing.lastRosterAt : 0;
  if (Date.now() - lastRosterAt >= ROSTER_INTERVAL_MS && !(await backendPaused())) {
    await fetchRoster().catch(() => {});
  }
}

function backgroundPoll() {
  if (!pollInFlight) {
    pollInFlight = runBackgroundPoll()
      .catch((e) => console.warn("[Reidey bg] poll failed:", e?.message))
      .finally(() => {
        pollInFlight = null;
      });
  }
  return pollInFlight;
}

/** Create the poll alarm once; re-creating it on every wake resets its schedule. */
async function ensurePollAlarm() {
  if (!api.alarms) return;
  try {
    const existing = await api.alarms.get(POLL_ALARM);
    if (!existing) api.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  } catch {
    api.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  }
}

api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    backgroundPoll();
    sweepPendingTabCloses();
  }
  if (alarm.name === TAB_CLOSE_ALARM) sweepPendingTabCloses();
});

// Poll right away only on install/update and browser start — not on every worker
// wake, which already comes with its own alarm event.
api.runtime.onInstalled?.addListener(() => {
  ensurePollAlarm();
  backgroundPoll();
});
api.runtime.onStartup?.addListener(() => {
  ensurePollAlarm();
  backgroundPoll();
});

ensurePollAlarm();
sweepPendingTabCloses();
