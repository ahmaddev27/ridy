// Runs on vsdispatch.uber.com / supplier.uber.com. Watches for a logged-in
// state and, once the manager has finished signing in, asks the background
// worker to capture the session automatically — no button press needed.

(function ridyAutoCapture() {
  const api = globalThis.browser || globalThis["chrome"];

  const onFleetUi = /(^|\.)(supplier|fleethub)\.uber\.com$/i.test(location.host);

  function findOrgUuid() {
    // The fleet org uuid is right there in the Fleet Hub URL: /orgs/<uuid>/… —
    // the only reliable source. Scraping the page HTML used to pick up the first
    // generic "uuid" (a user, driver or vehicle) and bind THAT as the fleet org;
    // without the URL, the background discovers the org from the Fleet Hub
    // redirect of this session instead.
    const fromUrl = location.href.match(/\/orgs\/([0-9a-f-]{36})/i);
    return fromUrl ? fromUrl[1] : null;
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

  // Capture failures the manager has to act on — shown once, then we stop.
  const FINAL_REASONS = {
    not_paired: "Reidey: Bitte zuerst die Erweiterung im Dashboard koppeln.",
    bad_api_url: "Reidey: Bitte zuerst die Erweiterung im Dashboard koppeln.",
    unpaired: "Reidey: Kopplung abgelaufen – bitte das Reidey-Dashboard öffnen, um neu zu koppeln.",
    autolink_blocked: "Reidey: Verbindung getrennt – bitte im Dashboard neu verbinden.",
    uber_org_already_linked: "Reidey: Dieses Uber-Konto ist bereits mit einer anderen Firma verbunden.",
    company_inactive: "Reidey: Deine Firma ist derzeit nicht aktiv.",
    account_suspended: "Reidey: Dein Konto ist gesperrt – bitte den Support kontaktieren.",
  };
  // Still signing in / org not resolvable yet — retry quietly with backoff.
  const RETRY_REASONS = ["no_cookies", "no_org"];
  const RETRY_DELAYS_MS = [1500, 3000, 6000, 12000, 24000];

  /** One capture attempt. Resolves true when we should try again. */
  async function tryCapture(isLastAttempt) {
    // On account.uber.com there is no org uuid on the page — the background
    // worker discovers it from the supplier redirect, so send null and let it try.
    let res;
    try {
      res = await api.runtime.sendMessage({ type: "capture", orgUuid: findOrgUuid(), orgName: findOrgName() });
    } catch {
      return false; // extension reloaded under this page — nothing to retry with
    }

    if (res?.ok) {
      toast(
        res.reason === "unchanged" ? "Reidey: bereits verbunden ✓" : "Reidey: Uber-Sitzung verbunden ✓",
        true,
      );
      return false;
    }
    const reason = res?.reason || "";
    if (FINAL_REASONS[reason]) {
      // autolink_blocked is expected after a disconnect: say it quietly, once.
      toast(FINAL_REASONS[reason], reason === "autolink_blocked");
      return false;
    }
    if (RETRY_REASONS.includes(reason) || !res?.status) {
      // Network hiccup or still signing in: retry; name a real error only at the end.
      if (isLastAttempt && reason && !RETRY_REASONS.includes(reason)) toast(`Reidey: ${reason}`, false);
      return true;
    }
    toast(`Reidey: ${reason}`, false); // any other backend rejection — don't loop on it
    return false;
  }

  // Poll briefly after load — the dashboard hydrates its user data asynchronously
  // and a fresh sign-in may still be settling. Backs off (1.5s → 24s, five
  // attempts in ~47s) so a login page never hammers Fleet Hub discovery.
  async function autoCapture() {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      const again = await tryCapture(i === RETRY_DELAYS_MS.length - 1);
      if (!again) return;
    }
  }

  // auth.uber.com always redirects on to Fleet Hub / account after sign-in, and
  // the capture runs there. The devices/passkeys tabs are the ones we open right
  // after a successful Connect, so they only capture when nothing is linked yet.
  async function shouldAutoCapture() {
    if (/(^|\.)auth\.uber\.com$/i.test(location.host)) return false;
    if (/(^|\.)account\.uber\.com$/i.test(location.host) && /\/(devices|passkeys)/i.test(location.pathname)) {
      try {
        const { lastSync } = await api.storage.local.get(["lastSync"]);
        return !lastSync;
      } catch {
        return false;
      }
    }
    return true;
  }

  shouldAutoCapture().then((yes) => {
    if (yes) autoCapture();
  });

  // The driver roster is pulled on demand from the dashboard via the background
  // worker (correct paginated POST to supplier getDrivers using the stored org),
  // so no per-page polling is needed here.

  // ── RAMEN offer tap ───────────────────────────────────────────────────────
  // Passive Fleet-API capture: inject.js (MAIN world) tees every supplier
  // /api/* + /graphql response the page loads and posts it here; we forward each
  // to Reidey's generic /supplier/capture so every Uber Fleet page the manager
  // opens shows up in the admin Network feed. Only on the Fleet UI hosts (where
  // inject.js tees); the background re-checks the host and the DSGVO allowlist.
  if (onFleetUi) {
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ridy-capture") return;
      try {
        await api.runtime.sendMessage({ type: "supplier_capture", kind: event.data.kind, url: event.data.url, payload: event.data.payload });
      } catch {
        /* extension reloaded or not paired — ignore */
      }
    });

    // Stash a graphql request template (from inject.js) so the background worker can
    // later REPLAY it on demand — refreshing earnings without reopening the Uber
    // page. Just the request body, keyed by operationName; the background validates it.
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ridy-graphql-template") return;
      try {
        await api.runtime.sendMessage({
          type: "store_graphql_template",
          operationName: event.data.operationName,
          body: event.data.body,
        });
      } catch {
        /* extension reloaded or not paired — ignore */
      }
    });
  }

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
      } else if (out && !out.ok && Date.now() - offerToastAt > 4000) {
        offerToastAt = Date.now();
        toast(FINAL_REASONS[out.reason] || `Reidey: ${out.reason || "Fehler"}`, false);
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
    cleanupCompetitorPasskeysIfArmed();
  }

  async function evictOtherSessionsIfArmed() {
    // Only on the devices page (where the sign-out control lives). Without this
    // guard the passkeys tab would also run here and consume `evictArmed` first,
    // racing the devices tab out of its own eviction.
    if (!/\/devices/i.test(location.pathname)) return;
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
      const before = openDialogs();
      btn.click();
      // Click the affirmative control if Uber asks — only in the dialog THIS click
      // opened, never a consent/promo dialog that happened to be open already.
      const confirmed = await confirmIfDialog(6000, before, EVICT_DIALOG_CONTEXT);
      // Success means Uber acted: the confirmation was accepted, or the sign-out
      // control went away (no confirmation step). Anything else is not a success.
      const gone = await waitUntil(() => !findSignOutAllButton(), 8000);
      if (confirmed || gone) report(true, confirmed ? "confirmed" : "button_gone");
      else report(false, "not_confirmed");
    } catch (e) {
      report(false, e?.message || "evict_error");
    }
  }

  // A control that signs out the OTHER sessions — never the current one. Requires a
  // sign-out verb AND an explicit "other" word. We deliberately do NOT accept a bare
  // "all devices" / "alle Geräte": a button labelled only "sign out of all devices"
  // would evict THIS browser and the daemon's replayed session too (the suspected
  // cause of the 2026-09-13 offer outage). Uber's real control says "other" ("sign
  // out of all other sessions" / "von allen anderen Geräten abmelden"), so requiring
  // it keeps the current session — and the daemon's — alive.
  function isSignOutAllText(text) {
    const t = (text || "").toLowerCase().trim();
    if (!t || t.length > 80) return false;
    const verb = /(sign out|log out|logout|abmelden|abgemeldet)/.test(t);
    const other = /(other|others|andere|anderen|autres)/.test(t);
    return verb && other;
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

  const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';
  // What the dialog we expect is about. A dialog that says none of this (cookie
  // consent, promo, survey) is never touched.
  // (Deliberately no "device"/"session": consent banners talk about both.)
  const EVICT_DIALOG_CONTEXT = /(sign out|signout|log out|logout|abmelden|abgemeldet)/i;
  const PASSKEY_DIALOG_CONTEXT = /(passkey|pass key|remove|entfernen|l[öo]schen)/i;

  function openDialogs() {
    return new Set(document.querySelectorAll(DIALOG_SELECTOR));
  }

  /** Resolve true once `predicate()` holds, or false after timeoutMs. */
  function waitUntil(predicate, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        let ok = false;
        try {
          ok = !!predicate();
        } catch {
          ok = false;
        }
        if (ok || Date.now() - started > timeoutMs) {
          clearInterval(iv);
          resolve(ok);
        }
      }, 500);
    });
  }

  // If a confirmation dialog appears, click its affirmative control — but ONLY
  // inside a dialog that opened after our click (not in `before`) and that reads
  // like the action we took, never a stray page button, and never "Cancel".
  // Resolves true when a confirmation was clicked.
  function confirmIfDialog(timeoutMs, before, context) {
    const affirmative = /^(sign out|log out|logout|abmelden|confirm|best[äa]tigen|bestaetigen|continue|weiter|yes|ja|ok|delete|remove|l[öo]schen|entfernen)$/i;
    const negative = /(cancel|abbrechen|zur[üu]ck|zurueck|nein|dismiss|schlie[ßs]en|schliessen)/i;
    const tryConfirm = () => {
      for (const dialog of document.querySelectorAll(DIALOG_SELECTOR)) {
        if (before.has(dialog) || !context.test(dialog.textContent || "")) continue;
        for (const b of dialog.querySelectorAll('button, [role="button"]')) {
          const label = (b.getAttribute("aria-label") || b.textContent || "").trim();
          if (!label || negative.test(label.toLowerCase())) continue;
          if (affirmative.test(label)) {
            b.click();
            return true;
          }
        }
      }
      return false;
    };
    return waitUntil(tryConfirm, timeoutMs);
  }

  // ── Remove a competitor's Linux/server passkey ──────────────────────────────
  // A rival that linked the operator's Uber account can register a passkey to log
  // back in even after we sign out its sessions. We remove ONLY passkeys whose
  // device reads as a headless / Linux / server profile — never the operator's own
  // phone/PC (Samsung Pass, Chrome on Windows, iPhone, Mac…), which are matched by
  // PERSONAL and always kept. If no such passkey exists, this deletes nothing.
  const COMPETITOR_PASSKEY =
    /(linux|ubuntu|debian|fedora|cent\s*os|red\s*hat|\barch\b|headless|\bserver\b|\bvps\b|\bcloud\b|puppeteer|playwright|selenium|python|node\.?js|\bbot\b|chromium)/i;
  const PERSONAL_PASSKEY =
    /(samsung|galaxy|iphone|ipad|\bios\b|android|pixel|windows|macbook|\bmac\b|macos|\bedge\b|safari)/i;

  function passkeyRows() {
    const rows = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length !== 0) continue; // leaf text nodes
      if (!/date created/i.test(el.textContent || "")) continue;
      // The row is the nearest ancestor that also holds the delete (trash) button.
      let row = el;
      for (let i = 0; i < 6 && row; i++) {
        if (row.querySelector && row.querySelector('button, [role="button"]')) break;
        row = row.parentElement;
      }
      if (!row || seen.has(row)) continue;
      seen.add(row);
      const button = row.querySelector('button, [role="button"]');
      if (!button) continue;
      const name = (row.textContent || "").replace(/date created[\s\S]*/i, "").trim();
      if (name) rows.push({ name, button });
    }
    return rows;
  }

  function isCompetitorPasskey(name) {
    return COMPETITOR_PASSKEY.test(name || "") && !PERSONAL_PASSKEY.test(name || "");
  }

  // Authoritative list of the account's passkeys, straight from Uber's own API
  // (getPasskeysInfo). It is NOT Arkose-gated (only the DELETE is), so this reads
  // cleanly from the page origin and gives us the exact device names + keyIds —
  // reliable detection instead of scraping the DOM. Returns [] on any failure so
  // the caller falls back to DOM scraping.
  async function listPasskeysViaApi() {
    return (await fetchPasskeyNames()) ?? [];
  }

  /** Passkey names from the API, or null when the API could not be read. */
  async function fetchPasskeyNames() {
    try {
      const res = await fetch("https://account.uber.com/api/getPasskeysInfo?localeCode=en", {
        method: "POST",
        credentials: "include",
        headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
        body: "{}",
      });
      if (!res.ok) return null;
      const body = await res.json();
      const list = body?.data?.publicKeyCredentials;
      if (!Array.isArray(list)) return null;
      return list.map((c) => (c?.passkeyInfo?.name || "").trim()).filter(Boolean);
    } catch {
      return null;
    }
  }

  /** True once `name` no longer exists (API first, DOM when the API is unreadable). */
  async function waitForPasskeyGone(name, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      const names = await fetchPasskeyNames();
      if (names ? !names.includes(name) : !trashButtonForName(name)) return true;
    }
    return false;
  }

  // The trash button for the row whose visible name equals `name`. The DELETE is
  // Arkose-gated, so we can't call it directly — clicking Uber's own control lets
  // the page mint the one-time challenge token transparently (same as the session
  // eviction). Matching by the API-confirmed name keeps us off the wrong row.
  function trashButtonForName(name) {
    const target = (name || "").toLowerCase().trim();
    if (!target) return null;
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length !== 0) continue; // leaf text nodes
      if ((el.textContent || "").toLowerCase().trim() !== target) continue;
      let row = el;
      for (let i = 0; i < 6 && row; i++) {
        const btn = row.querySelector && row.querySelector('button, [role="button"]');
        if (btn) return btn;
        row = row.parentElement;
      }
    }
    return null;
  }

  function waitForPasskeyList(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (passkeyRows().length > 0 || Date.now() - started > timeoutMs) {
          cleanup();
          resolve();
        }
      };
      const obs = new MutationObserver(check);
      const iv = setInterval(check, 800);
      function cleanup() {
        obs.disconnect();
        clearInterval(iv);
      }
      obs.observe(document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  async function cleanupCompetitorPasskeysIfArmed() {
    if (!/\/passkeys/i.test(location.pathname)) return;
    let armed;
    try {
      ({ passkeyCleanupArmed: armed } = await api.storage.local.get(["passkeyCleanupArmed"]));
    } catch {
      return; // stale extension context
    }
    if (!armed || typeof armed.at !== "number" || Date.now() - armed.at > 120000) return;
    try {
      await api.storage.local.remove("passkeyCleanupArmed");
    } catch {
      /* ignore */
    }

    const deleted = [];
    const failed = [];
    try {
      await waitForPasskeyList(20000);

      // DETECT via the API (authoritative names); fall back to DOM scraping if it
      // fails. DELETE via the UI click (the endpoint is Arkose-gated — a one-time
      // challenge token the page mints when the real button is clicked, which we
      // can't forge or replay from a background fetch). A name only counts as
      // deleted once it is actually gone, never just because we clicked.
      const apiNames = await listPasskeysViaApi();
      const targets = apiNames.filter(isCompetitorPasskey);

      if (targets.length > 0) {
        for (const name of targets.slice(0, 10)) {
          const btn = trashButtonForName(name);
          if (!btn) continue; // couldn't locate the row — skip (fail-safe)
          const before = openDialogs();
          btn.click();
          await confirmIfDialog(6000, before, PASSKEY_DIALOG_CONTEXT); // Uber's "Remove" → Arkose runs transparently
          const gone = await waitForPasskeyGone(name, 6000);
          (gone ? deleted : failed).push(name);
        }
      } else if (apiNames.length === 0) {
        // The API gave us nothing (network/format) — fall back to DOM detection.
        const tried = new Set();
        for (let i = 0; i < 10; i++) {
          const row = passkeyRows().find((r) => isCompetitorPasskey(r.name) && !tried.has(r.name));
          if (!row) break;
          tried.add(row.name);
          const before = openDialogs();
          row.button.click();
          await confirmIfDialog(6000, before, PASSKEY_DIALOG_CONTEXT);
          const gone = await waitUntil(() => !passkeyRows().some((r) => r.name === row.name), 6000);
          (gone ? deleted : failed).push(row.name);
        }
      }
    } catch {
      /* best-effort */
    }
    api.runtime.sendMessage({ type: "passkeyResult", deleted, failed }).catch(() => {});
  }
})();
