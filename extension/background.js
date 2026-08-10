// Reidey background worker — owns cookie access and the POST to Reidey. Content
// scripts (which can't read httpOnly cookies) message it with a detected org
// uuid; it captures the full cookie jar and syncs the session. It only re-sends
// when the session actually changes, so a normal login triggers exactly one sync.
//
// Cross-browser: Firefox exposes `browser.*` (promises), Chrome `chrome.*`
// (promises in MV3). This shim lets one codebase run on both.
const api = globalThis.browser || globalThis["chrome"];

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

/** A cheap fingerprint so we don't re-POST an unchanged session on every visit. */
function fingerprint(orgUuid, cookies) {
  return orgUuid + "|" + cookies.length + "|" + cookies.map((c) => c.value.length).join(",");
}

async function capture(orgUuid, orgName, { manual = false } = {}) {
  const { apiUrl, token, lastSync } = await api.storage.local.get(["apiUrl", "token", "lastSync"]);
  if (!apiUrl || !token) {
    return { ok: false, reason: "not_paired" };
  }

  const cookies = await readCookies();
  if (cookies.length === 0) return { ok: false, reason: "no_cookies" };

  const fp = fingerprint(orgUuid, cookies);
  if (!manual && lastSync === fp) {
    return { ok: true, reason: "unchanged" }; // already synced this session
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/fleet-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ uber_org_uuid: orgUuid, cookies, uber_org_name: orgName || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    // Remember the org so the on-demand roster pull (from the dashboard, with no
    // supplier tab open) knows which fleet to query.
    await api.storage.local.set({ lastSync: fp, orgUuid });
    return { ok: true, count: cookies.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Forward the driver roster (captured from the manager's browser) to Reidey. */
async function postRoster(drivers) {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  console.log("[Reidey bg] postRoster", { drivers: drivers.length, apiUrl, hasToken: !!token });
  if (!apiUrl || !token) return { ok: false, reason: "not_paired" };

  try {
    const res = await fetch(`${apiUrl}/api/v1/drivers/roster`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ drivers }),
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
 * Pull the roster straight from supplier.uber.com using the manager's own
 * cookies and real browser IP (Uber blocks datacenter IPs, so this is the
 * reliable path), then forward it to Reidey. Triggered on demand from the
 * dashboard — no supplier tab needs to be open.
 */
// Uber's supplier getDrivers is a POST that pages through the roster. These are
// the filters the supplier UI itself sends (all empty = "everyone").
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
      const res = await fetch("https://supplier.uber.com/api/getDrivers?localeCode=en-GB", {
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
      if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };

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
  const { orgUuid, apiUrl, token } = await api.storage.local.get(["orgUuid", "apiUrl", "token"]);
  if (!orgUuid) return { ok: false, reason: "no_org_uuid" };
  if (!apiUrl || !token) return { ok: false, reason: "not_paired" };

  let uberData;
  try {
    const res = await fetch("https://supplier.uber.com/api/GetEarnerMetrics?localeCode=en-GB", {
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
    metrics[field] = v.doubleValue ?? v.int64Value ?? v.stringValue ?? null;
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
  const { orgUuid, apiUrl, token } = await api.storage.local.get(["orgUuid", "apiUrl", "token"]);
  if (!orgUuid) return { ok: false, reason: "no_org_uuid" };
  if (!apiUrl || !token) return { ok: false, reason: "not_paired" };

  let vehicles;
  try {
    const res = await fetch("https://supplier.uber.com/graphql", {
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

/** Forward RAMEN offers (captured in the manager's browser) to Reidey. */
async function postOffers(offers, seq) {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  console.log("[Reidey bg] postOffers", { offers: offers.length, apiUrl, hasToken: !!token });
  if (!apiUrl || !token) return { ok: false, reason: "not_paired" };

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

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "capture" && msg.orgUuid) {
    capture(msg.orgUuid, msg.orgName, { manual: !!msg.manual }).then(sendResponse);
    return true; // async response
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
  if (msg?.type === "offers" && Array.isArray(msg.offers)) {
    postOffers(msg.offers, msg.seq).then(sendResponse);
    return true;
  }
});
