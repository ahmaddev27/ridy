// Auto-pairing content script — runs on the Ridy dashboard. The dashboard knows
// its own backend URL and can mint a token, so it hands both to the extension via
// window.postMessage. The manager never types a URL or pastes a token.

const api = globalThis.browser || globalThis["chrome"];

// Announce presence so the dashboard can tell whether the extension is installed
// (both on load and on demand, since the page may mount after this script runs).
function announce() {
  window.postMessage({ source: "ridy-ext-present" }, "*");
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
