// Runs on vsdispatch.uber.com / supplier.uber.com. Watches for a logged-in
// state and, once the manager has finished signing in, asks the background
// worker to capture the session automatically — no button press needed.

(function ridyAutoCapture() {
  const api = globalThis.browser || globalThis["chrome"];
  let done = false;

  function findOrgUuid() {
    // The fleet org uuid is right there in the supplier URL: /orgs/<uuid>/… —
    // the most reliable source. Fall back to scraping the (SPA) HTML.
    const fromUrl = location.href.match(/\/orgs\/([0-9a-f-]{36})/i);
    if (fromUrl) return fromUrl[1];

    const html = document.documentElement.innerHTML;
    const m =
      html.match(/CustomerGatewayUser:([0-9a-f-]{36})/i) ||
      html.match(/"orgUuid"\s*:\s*"([0-9a-f-]{36})"/i) ||
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
    // On account.uber.com there is no org uuid on the page — the background
    // worker discovers it from the supplier redirect, so send null and let it try.
    const orgUuid = findOrgUuid();

    done = true; // one attempt in flight at a time
    const res = await api.runtime.sendMessage({ type: "capture", orgUuid: orgUuid || null, orgName: findOrgName() });

    if (res?.ok) {
      toast(
        res.reason === "unchanged" ? "Reidey: bereits verbunden ✓" : "Reidey: Uber-Sitzung verbunden ✓",
        true,
      );
    } else if (res && !res.ok) {
      done = false; // retry — still signing in, or the org isn't resolvable yet
      if (res.reason === "not_paired") {
        toast("Reidey: Bitte zuerst die Erweiterung im Dashboard koppeln.", false);
      } else if (!["no_cookies", "no_org"].includes(res.reason)) {
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
  // Passive Fleet-API capture: inject.js (MAIN world) tees every supplier
  // /api/* + /graphql response the page loads and posts it here; we forward each
  // to Reidey's generic /supplier/capture so every Uber Fleet page the manager
  // opens shows up in the admin Network feed. Runs on any injected Uber domain.
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ridy-capture") return;
    try {
      await api.runtime.sendMessage({ type: "supplier_capture", kind: event.data.kind, url: event.data.url, payload: event.data.payload });
    } catch {
      /* extension reloaded or not paired — ignore */
    }
  });

  // Stash a graphql request template (from inject.js) so the background worker can
  // later REPLAY it on demand — refreshing earnings/timeline without reopening the
  // Uber page. Just the request body + url, keyed by operationName.
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ridy-graphql-template") return;
    try {
      await api.runtime.sendMessage({
        type: "store_graphql_template",
        operationName: event.data.operationName,
        url: event.data.url,
        body: event.data.body,
      });
    } catch {
      /* extension reloaded or not paired — ignore */
    }
  });

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
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ridy-offer") return;
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

  // ── Evict the operator's OTHER Uber sessions (opt-in) ──────────────────────
  // Runs only on account.uber.com and only when the background worker armed it
  // right after a Connect the manager opted into. We click Uber's OWN "sign out
  // all OTHER devices" button so Uber runs its Arkose bot-defense transparently
  // (no forged tokens, no raw endpoint call). We NEVER click a plain single
  // "Log out" — the matcher requires a scope word (all/other/devices), so the
  // CURRENT session (which the daemon replays) is preserved.
  if (/(^|\.)account\.uber\.com$/i.test(location.host)) {
    evictOtherSessionsIfArmed();
  }

  async function evictOtherSessionsIfArmed() {
    let armed;
    try {
      ({ evictArmed: armed } = await api.storage.local.get(["evictArmed"]));
    } catch {
      return; // stale extension context
    }
    // Only a fresh arm (<2 min) may act, so a normal later visit signs out nobody.
    if (!armed || typeof armed.at !== "number" || Date.now() - armed.at > 120000) return;
    // Consume immediately so a reload or second frame can't double-fire.
    try {
      await api.storage.local.remove("evictArmed");
    } catch {
      /* ignore */
    }

    const report = (ok, reason) =>
      api.runtime.sendMessage({ type: "evictResult", ok, reason }).catch(() => {});

    try {
      const btn = await waitForSignOutAllButton(25000);
      if (!btn) return report(false, "button_not_found");
      btn.click();
      await confirmIfDialog(6000); // click the affirmative control if Uber asks
      report(true, "clicked");
    } catch (e) {
      report(false, e?.message || "evict_error");
    }
  }

  // A control that signs out ALL / all OTHER sessions: a sign-out verb AND a
  // scope word. Requiring the scope word is the safety guard against clicking a
  // plain single-session logout, which would evict the current session.
  function isSignOutAllText(text) {
    const t = (text || "").toLowerCase().trim();
    if (!t || t.length > 80) return false;
    const verb = /(sign out|log out|logout|abmelden|abgemeldet)/.test(t);
    const scope =
      /(all|other|every|alle|allen|andere|anderen|ger[äa]te|geraete|devices|sessions|sitzungen|[üu]berall|ueberall)/.test(t);
    return verb && scope;
  }

  function findSignOutAllButton() {
    const nodes = document.querySelectorAll(
      'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]',
    );
    for (const el of nodes) {
      // Skip elements that aren't actually visible/clickable.
      if (el.offsetParent === null && el.getClientRects().length === 0) continue;
      const label = el.getAttribute("aria-label") || el.value || el.textContent || "";
      if (isSignOutAllText(label)) return el;
    }
    return null;
  }

  // Poll + observe the SPA until the button renders, or give up after timeoutMs.
  function waitForSignOutAllButton(timeoutMs) {
    return new Promise((resolve) => {
      const immediate = findSignOutAllButton();
      if (immediate) return resolve(immediate);

      const started = Date.now();
      const check = () => {
        const b = findSignOutAllButton();
        if (b) {
          cleanup();
          resolve(b);
        } else if (Date.now() - started > timeoutMs) {
          cleanup();
          resolve(null);
        }
      };
      const obs = new MutationObserver(check);
      const iv = setInterval(check, 800);
      function cleanup() {
        obs.disconnect();
        clearInterval(iv);
      }
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // If a confirmation dialog appears, click its affirmative control — but ONLY
  // inside a real dialog element, never a stray page button, and never "Cancel".
  function confirmIfDialog(timeoutMs) {
    return new Promise((resolve) => {
      const affirmative = /^(sign out|log out|logout|abmelden|confirm|best[äa]tigen|bestaetigen|continue|weiter|yes|ja|ok)$/i;
      const negative = /(cancel|abbrechen|zur[üu]ck|zurueck|nein|dismiss|schlie[ßs]en|schliessen)/i;
      const started = Date.now();
      const iv = setInterval(() => {
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
        if (dialog) {
          for (const b of dialog.querySelectorAll('button, [role="button"]')) {
            const label = (b.getAttribute("aria-label") || b.textContent || "").trim();
            if (!label || negative.test(label.toLowerCase())) continue;
            if (affirmative.test(label)) {
              b.click();
              clearInterval(iv);
              return resolve();
            }
          }
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(iv);
          resolve();
        }
      }, 500);
    });
  }
})();
