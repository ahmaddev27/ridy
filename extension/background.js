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
      return { ok: false, reason: body.message || `http_${res.status}` };
    }
    const body = await res.json();
    return { ok: true, ...body.data };
  } catch (e) {
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
});
