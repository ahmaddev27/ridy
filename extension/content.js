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

  // Best-effort fleet/organization name from the page's embedded state, so the
  // company in Reidey can adopt its real Uber name at link time.
  function findOrgName() {
    const html = document.documentElement.innerHTML;
    const patterns = [
      /"organizationName"\s*:\s*"([^"]{2,120})"/i,
      /"orgName"\s*:\s*"([^"]{2,120})"/i,
      /"partnerName"\s*:\s*"([^"]{2,120})"/i,
      /"fleetName"\s*:\s*"([^"]{2,120})"/i,
      /"organization"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"]{2,120})"/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1].trim()) return m[1].trim();
    }
    return null;
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
    const res = await api.runtime.sendMessage({ type: "capture", orgUuid, orgName: findOrgName() });

    if (res?.ok) {
      // Confirm whether it was freshly captured or already connected.
      toast(
        res.reason === "unchanged" ? "Reidey: bereits verbunden ✓" : "Reidey: Uber-Sitzung verbunden ✓",
        true,
      );
    } else if (res && !res.ok) {
      done = false; // allow a later retry (e.g. after pairing)
      if (res.reason === "not_paired") {
        toast("Reidey: Bitte zuerst die Erweiterung im Dashboard koppeln.", false);
      } else if (res.reason !== "no_cookies") {
        toast(`Reidey: ${res.reason}`, false);
      }
    }
  }

  // Poll briefly after load — the dashboard hydrates its user data asynchronously.
  const started = Date.now();
  const timer = setInterval(() => {
    tryCapture();
    if (done || Date.now() - started > 60000) clearInterval(timer);
  }, 1500);

  // The driver roster is pulled on demand from the dashboard via the background
  // worker (correct paginated POST to supplier getDrivers using the stored org),
  // so no per-page polling is needed here.

  // ── RAMEN offer tap ───────────────────────────────────────────────────────
  // On vsdispatch.uber.com we do NOT open our own dispatch stream — that would
  // compete with Uber's own page for the same seq-numbered messages, so each
  // offer would land in only one of them. Instead we inject a page-world script
  // (inject.js) that passively tees Uber's own recv stream and posts every
  // offer here; we just forward them to Reidey. No competition, no message loss.
  if (/vsdispatch\.uber\.com/i.test(location.host)) {
    // inject.js is registered as a MAIN-world content script in the manifest,
    // so it patches the page's fetch directly (no CSP-blocked <script> inject).
    console.log("%c[Reidey content]", "color:#2563eb;font-weight:700", "listening for offers from the page tap");

    let offerToastAt = 0;
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.data?.source !== "ridy-offer") return;
      const offers = event.data.offers ?? [];
      if (offers.length === 0) return;

      console.log("%c[Reidey content]", "color:#2563eb;font-weight:700", `forwarding ${offers.length} offer(s) to background`);

      let out;
      try {
        out = await api.runtime.sendMessage({ type: "offers", offers, seq: event.data.seq });
      } catch (e) {
        // Happens when the extension was reloaded/updated but this tab still
        // runs the old content script — the page must be refreshed to reconnect.
        if (/context invalidated/i.test(e.message)) {
          console.warn("%c[Reidey content]", "color:#dc2626;font-weight:700", "extension was updated — please refresh this tab (F5) to reconnect.");
          toast("Reidey: Bitte diese Seite neu laden (F5), um fortzufahren.", false);
        } else {
          console.error("%c[Reidey content]", "color:#dc2626;font-weight:700", "send failed:", e.message);
        }
        return;
      }
      console.log("%c[Reidey content]", "color:#2563eb;font-weight:700", "background replied:", out);

      // Throttle toasts so a burst of offers doesn't spam the screen.
      if (out?.ok && Date.now() - offerToastAt > 4000) {
        offerToastAt = Date.now();
        toast(`Reidey: ${offers.length} Angebot(e) empfangen ✓`, true);
      } else if (out && !out.ok) {
        toast(`Reidey: ${out.reason || "Fehler"}`, false);
      }
    });
  }
})();
