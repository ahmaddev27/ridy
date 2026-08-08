// Runs on vsdispatch.uber.com / supplier.uber.com. Watches for a logged-in
// state and, once the manager has finished signing in, asks the background
// worker to capture the session automatically — no button press needed.

(function ridyAutoCapture() {
  const api = globalThis.browser || globalThis["chrome"];
  let done = false;

  function findOrgUuid() {
    const html = document.documentElement.innerHTML;
    const m =
      html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) ||
      html.match(/"uuid":"([0-9a-f-]{36})"/i);
    return m ? m[1] : null;
  }

  function toast(message, ok) {
    const el = document.createElement("div");
    el.textContent = message;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: 2147483647,
      padding: "10px 14px",
      borderRadius: "8px",
      font: "600 13px system-ui, sans-serif",
      color: "#fff",
      background: ok ? "#059669" : "#dc2626",
      boxShadow: "0 4px 12px rgba(0,0,0,.2)",
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function tryCapture() {
    if (done) return;
    const orgUuid = findOrgUuid();
    if (!orgUuid) return; // not logged in yet

    done = true; // attempt once per page load
    const res = await api.runtime.sendMessage({ type: "capture", orgUuid });

    if (res?.ok) {
      // Confirm whether it was freshly captured or already connected.
      toast(
        res.reason === "unchanged" ? "Ridy: bereits verbunden ✓" : "Ridy: Uber-Sitzung verbunden ✓",
        true,
      );
    } else if (res && !res.ok) {
      done = false; // allow a later retry (e.g. after pairing)
      if (res.reason === "not_paired") {
        toast("Ridy: Bitte zuerst die Erweiterung im Dashboard koppeln.", false);
      } else if (res.reason !== "no_cookies") {
        toast(`Ridy: ${res.reason}`, false);
      }
    }
  }

  // Poll briefly after load — the dashboard hydrates its user data asynchronously.
  const started = Date.now();
  const timer = setInterval(() => {
    tryCapture();
    if (done || Date.now() - started > 60000) clearInterval(timer);
  }, 1500);

  // On supplier.uber.com, also pull the driver roster from the manager's own
  // browser (real IP → Uber responds) and forward it. Server-side pulls get
  // blocked by Uber's datacenter check, so this is the reliable path.
  let rosterDone = false;
  async function tryRoster() {
    if (rosterDone) return;
    if (!/supplier\.uber\.com/i.test(location.host)) return;
    try {
      const res = await fetch("/api/getDrivers?localeCode=en", { credentials: "include" });
      if (!res.ok) return;
      const body = await res.json();
      const drivers = body?.data?.drivers ?? [];
      if (drivers.length === 0) return;
      rosterDone = true;
      const out = await api.runtime.sendMessage({ type: "roster", drivers });
      toast(out?.ok ? `Ridy: ${drivers.length} Fahrer synchronisiert ✓` : `Ridy: ${out?.reason || "Fehler"}`, !!out?.ok);
    } catch {
      /* best-effort */
    }
  }
  const rosterTimer = setInterval(() => {
    tryRoster();
    if (rosterDone || Date.now() - started > 60000) clearInterval(rosterTimer);
  }, 3000);

  // ── RAMEN offer tap ───────────────────────────────────────────────────────
  // On vsdispatch.uber.com we do NOT open our own dispatch stream — that would
  // compete with Uber's own page for the same seq-numbered messages, so each
  // offer would land in only one of them. Instead we inject a page-world script
  // (inject.js) that passively tees Uber's own recv stream and posts every
  // offer here; we just forward them to Ridy. No competition, no message loss.
  if (/vsdispatch\.uber\.com/i.test(location.host)) {
    // inject.js is registered as a MAIN-world content script in the manifest,
    // so it patches the page's fetch directly (no CSP-blocked <script> inject).
    console.log("%c[Ridy content]", "color:#2563eb;font-weight:700", "listening for offers from the page tap");

    let offerToastAt = 0;
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.data?.source !== "ridy-offer") return;
      const offers = event.data.offers ?? [];
      if (offers.length === 0) return;

      console.log("%c[Ridy content]", "color:#2563eb;font-weight:700", `forwarding ${offers.length} offer(s) to background`);
      const out = await api.runtime.sendMessage({ type: "offers", offers, seq: event.data.seq });
      console.log("%c[Ridy content]", "color:#2563eb;font-weight:700", "background replied:", out);

      // Throttle toasts so a burst of offers doesn't spam the screen.
      if (out?.ok && Date.now() - offerToastAt > 4000) {
        offerToastAt = Date.now();
        toast(`Ridy: ${offers.length} Angebot(e) empfangen ✓`, true);
      } else if (out && !out.ok) {
        toast(`Ridy: ${out.reason || "Fehler"}`, false);
      }
    });
  }
})();
