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
    document.body.appendChild(el);
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

  // ── RAMEN offer stream ────────────────────────────────────────────────────
  // On vsdispatch.uber.com we hold the live dispatch stream from the manager's
  // own browser (real IP → Uber responds; our server IP is blocked) and forward
  // every offer to Ridy. Uber pushes across parallel regional channels, so we
  // read them all. Ingestion de-dups by offer_uuid, so overlap is harmless.
  if (/vsdispatch\.uber\.com/i.test(location.host)) {
    const CHANNELS = ["/ramendca/events", "/ramenphx/events"];
    let offerToastAt = 0;

    async function forwardOffers(offers, seq) {
      const out = await api.runtime.sendMessage({ type: "offers", offers, seq });
      // Throttle toasts so a burst of offers doesn't spam the screen.
      if (out?.ok && Date.now() - offerToastAt > 4000) {
        offerToastAt = Date.now();
        toast(`Ridy: ${offers.length} Angebot(e) empfangen ✓`, true);
      }
    }

    function extractOffers(payload) {
      const result = [];
      let maxSeq = null;
      for (const message of payload?.msg ?? []) {
        if (typeof message.seq === "number") maxSeq = Math.max(maxSeq ?? message.seq, message.seq);
        if (message.type !== "push_fleet_unified_offer") continue;
        let inner;
        try {
          inner = typeof message.msg === "string" ? JSON.parse(message.msg) : message.msg;
        } catch {
          continue;
        }
        for (const offer of inner?.offers ?? []) result.push({ offer, seq: message.seq });
      }
      return { offers: result, maxSeq };
    }

    async function runChannel(path) {
      let seq = 0;
      // Reconnect forever while the tab stays open.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await fetch(`${path}/ack?seq=${seq}`, { credentials: "include" });
          const recv = await fetch(`${path}/recv?seq=${seq}`, { credentials: "include" });
          if (!recv.ok || !recv.body) throw new Error(`recv ${recv.status}`);

          const reader = recv.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              let payload;
              try {
                payload = JSON.parse(data);
              } catch {
                continue;
              }
              const { offers, maxSeq } = extractOffers(payload);
              if (maxSeq != null) seq = Math.max(seq, maxSeq);
              if (offers.length) {
                // Forward each offer with the seq of its own message.
                for (const item of offers) forwardOffers([item.offer], item.seq);
              }
            }
          }
        } catch {
          /* fall through to backoff + reconnect */
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    for (const channel of CHANNELS) runChannel(channel);
  }
})();
