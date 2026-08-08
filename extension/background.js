// Ridy background worker — owns cookie access and the POST to Ridy. Content
// scripts (which can't read httpOnly cookies) message it with a detected org
// uuid; it captures the full cookie jar and syncs the session. It only re-sends
// when the session actually changes, so a normal login triggers exactly one sync.
//
// Cross-browser: Firefox exposes `browser.*` (promises), Chrome `chrome.*`
// (promises in MV3). This shim lets one codebase run on both.
const api = globalThis.browser || globalThis["chrome"];

async function readCookies() {
  const cookies = await api.cookies.getAll({ domain: "uber.com" });
  return cookies.map((c) => ({ name: c.name, value: c.value }));
}

/** A cheap fingerprint so we don't re-POST an unchanged session on every visit. */
function fingerprint(orgUuid, cookies) {
  return orgUuid + "|" + cookies.length + "|" + cookies.map((c) => c.value.length).join(",");
}

async function capture(orgUuid, { manual = false } = {}) {
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
      body: JSON.stringify({ uber_org_uuid: orgUuid, cookies }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    await api.storage.local.set({ lastSync: fp });
    return { ok: true, count: cookies.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Forward the driver roster (captured from the manager's browser) to Ridy. */
async function postRoster(drivers) {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  console.log("[Ridy bg] postRoster", { drivers: drivers.length, apiUrl, hasToken: !!token });
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
      console.warn("[Ridy bg] roster ingest failed", res.status, body);
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    const body = await res.json();
    console.log("[Ridy bg] roster ingest ok", body.data);
    return { ok: true, ...body.data };
  } catch (e) {
    console.error("[Ridy bg] roster ingest error", e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * Pull the roster straight from supplier.uber.com using the manager's own
 * cookies and real browser IP (Uber blocks datacenter IPs, so this is the
 * reliable path), then forward it to Ridy. Triggered on demand from the
 * dashboard — no supplier tab needs to be open.
 */
async function fetchRoster() {
  try {
    const res = await fetch("https://supplier.uber.com/api/getDrivers?localeCode=en", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    console.log("[Ridy bg] getDrivers ->", res.status);
    if (!res.ok) return { ok: false, reason: `supplier_http_${res.status}` };

    const body = await res.json();
    const drivers = body?.data?.drivers ?? [];
    console.log("[Ridy bg] getDrivers returned", drivers.length, "drivers");
    if (drivers.length === 0) return { ok: false, reason: "no_drivers" };

    return await postRoster(drivers);
  } catch (e) {
    console.error("[Ridy bg] fetchRoster error", e.message);
    return { ok: false, reason: e.message };
  }
}

/** Forward RAMEN offers (captured in the manager's browser) to Ridy. */
async function postOffers(offers, seq) {
  const { apiUrl, token } = await api.storage.local.get(["apiUrl", "token"]);
  console.log("[Ridy bg] postOffers", { offers: offers.length, apiUrl, hasToken: !!token });
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
      console.warn("[Ridy bg] ingest failed", res.status, body);
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    const body = await res.json();
    console.log("[Ridy bg] ingest ok", body.data);
    return { ok: true, ...body.data };
  } catch (e) {
    console.error("[Ridy bg] ingest error", e.message);
    return { ok: false, reason: e.message };
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "capture" && msg.orgUuid) {
    capture(msg.orgUuid, { manual: !!msg.manual }).then(sendResponse);
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
  if (msg?.type === "offers" && Array.isArray(msg.offers)) {
    postOffers(msg.offers, msg.seq).then(sendResponse);
    return true;
  }
});
