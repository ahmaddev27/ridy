// Auto-pairing content script — runs on the Reidey dashboard. The dashboard knows
// its own backend URL and can mint a token, so it hands both to the extension via
// window.postMessage. The manager never types a URL or pastes a token.

const api = globalThis.browser || globalThis["chrome"];

// Only the real dashboard may pair the extension. Validating event.origin (not
// just event.source === window) stops any other page on a matched origin — or an
// XSS on the dashboard hosted elsewhere — from injecting a rogue apiUrl+token.
const ALLOWED_PAIR_ORIGINS = ["https://reidey.de", "http://localhost:3000", "http://127.0.0.1:3000"];

// Keep in sync with background.js — the paired backend host must be allowlisted.
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

// Announce presence so the dashboard can tell whether the extension is installed
// (both on load and on demand, since the page may mount after this script runs).
async function announce() {
  const version = api.runtime.getManifest?.().version ?? null;
  // Report whether we already hold a pairing token, so the dashboard can
  // silently re-pair us if it was lost (e.g. the extension was reinstalled).
  const { token } = await api.storage.local.get(["token"]);
  window.postMessage({ source: "ridy-ext-present", version, paired: !!token }, location.origin);
}
announce();
window.addEventListener("message", (e) => {
  if (e.source === window && e.data?.source === "ridy-ext-ping") announce();
});

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  // Reject pairings that don't come from a trusted dashboard origin.
  if (!ALLOWED_PAIR_ORIGINS.includes(event.origin)) return;
  const d = event.data;
  if (!d || d.source !== "ridy-pair" || !d.apiUrl || !d.token) return;

  const apiUrl = String(d.apiUrl).replace(/\/$/, "");
  // Never store a backend URL we wouldn't POST the Uber session to (E1).
  if (!isAllowedApiUrl(apiUrl)) return;

  await api.storage.local.set({
    apiUrl,
    token: String(d.token),
    lastSync: null, // force a fresh capture after re-pairing
  });

  // Let the page know pairing succeeded so it can show a confirmation.
  window.postMessage({ source: "ridy-pair-ack" }, location.origin);
});

// The dashboard's "connect" button signals an explicit connect intent right
// before it opens the Uber tab. We flag it so the background worker auto-closes
// that ONE tab after capturing — a manager who later opens supplier themselves
// keeps their tab (it still syncs silently, but never closes on them).
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.source !== "ridy-connect-intent") return;
  await api.runtime.sendMessage({ type: "connectIntent" }).catch(() => {});
});

// The Drivers page asks the extension to pull the roster from supplier.uber.com
// (manager's real IP → Uber responds), then reports the result back to the page.
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "ridy-sync-roster") return;

  console.log("%c[Reidey roster]", "color:#2563eb;font-weight:700", "dashboard asked for roster → fetching from supplier");
  const res = await api.runtime.sendMessage({ type: "fetchRoster" }).catch((e) => ({
    ok: false,
    reason: e?.message || "extension_error",
  }));
  console.log("%c[Reidey roster]", "color:#2563eb;font-weight:700", "background result:", res);
  window.postMessage({ source: "ridy-roster-done", ...res }, "*");
});

// The driver detail view asks the extension to pull that driver's metrics.
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "ridy-fetch-metrics" || !event.data.driverUuid) return;

  const res = await api.runtime
    .sendMessage({ type: "fetchMetrics", driverUuid: event.data.driverUuid, from: event.data.from, to: event.data.to })
    .catch((e) => ({ ok: false, reason: e?.message || "extension_error" }));
  window.postMessage({ source: "ridy-metrics-done", ...res }, "*");
});

// The Vehicles page asks the extension to pull the fleet's vehicles.
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.source !== "ridy-fetch-vehicles") return;
  const res = await api.runtime
    .sendMessage({ type: "fetchVehicles" })
    .catch((e) => ({ ok: false, reason: e?.message || "extension_error" }));
  window.postMessage({ source: "ridy-vehicles-done", ...res }, "*");
});

// The Drivers page asks the extension to refresh live online/offline presence.
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.source !== "ridy-fetch-statuses") return;
  const res = await api.runtime
    .sendMessage({ type: "fetchStatuses", driverUuids: event.data.driverUuids })
    .catch((e) => ({ ok: false, reason: e?.message || "extension_error" }));
  window.postMessage({ source: "ridy-statuses-done", ...res }, "*");
});
