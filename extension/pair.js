// Auto-pairing content script — runs on the Reidey dashboard. The dashboard knows
// its own backend URL and can mint a token, so it hands both to the extension via
// window.postMessage. The manager never types a URL or pastes a token.

const api = globalThis.browser || globalThis["chrome"];

// Announce presence so the dashboard can tell whether the extension is installed
// (both on load and on demand, since the page may mount after this script runs).
async function announce() {
  const version = api.runtime.getManifest?.().version ?? null;
  // Report whether we already hold a pairing token, so the dashboard can
  // silently re-pair us if it was lost (e.g. the extension was reinstalled).
  const { token } = await api.storage.local.get(["token"]);
  window.postMessage({ source: "ridy-ext-present", version, paired: !!token }, "*");
}
announce();
window.addEventListener("message", (e) => {
  if (e.source === window && e.data?.source === "ridy-ext-ping") announce();
});

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== "ridy-pair" || !d.apiUrl || !d.token) return;

  await api.storage.local.set({
    apiUrl: String(d.apiUrl).replace(/\/$/, ""),
    token: String(d.token),
    lastSync: null, // force a fresh capture after re-pairing
  });

  // Let the page know pairing succeeded so it can show a confirmation.
  window.postMessage({ source: "ridy-pair-ack" }, "*");
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
