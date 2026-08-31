// Runs in the PAGE's main world (registered as a MAIN-world content script) so
// it can wrap the page's own networking. Uber's dispatch UI streams offers over
// RAMEN — but not necessarily via fetch, so we tap all three transports it might
// use: fetch, XMLHttpRequest and EventSource. Whichever carries the recv stream,
// we passively read the same "data:" frames the page receives and post every
// offer to the content script. We never send acks, so we don't compete with the
// page for the seq-numbered messages.
(() => {
  const log = (...a) => console.log("%c[Reidey inject]", "color:#059669;font-weight:700", ...a);

  if (window.__ridyInjected) {
    log("already installed, skipping");
    return;
  }
  window.__ridyInjected = true;

  const isRecv = (u) => typeof u === "string" && /\/ramen\w*\/events\/recv/i.test(u);
  const isRamen = (u) => typeof u === "string" && /\/ramen\w*\/events\//i.test(u);

  // ── Passive capture of ALLOWLISTED Uber Fleet API responses ───────────────
  // DSGVO posture: "detect, don't surveil". We do NOT tee every supplier /api or
  // /graphql response — that would forward banking, invoices, payouts and driver
  // documents (financial/identity PII) to the backend whenever the manager browses
  // those tabs. Instead we capture ONLY the handful of endpoints the app actually
  // consumes: the roster, driver metrics, live status, vehicles and earnings.
  // Everything else (Documents, Banking, Invoices, Compliance, …) is dropped.
  // Only on supplier.uber.com (the Fleet dashboard) — its UI fetches with RELATIVE
  // paths ("/api/…", "/graphql"), so match the PATH, not the full host, or nothing
  // is ever captured. The RAMEN stream (vsdispatch) is handled separately above.
  const onSupplier = /(^|\.)supplier\.uber\.com$/i.test(location.host);
  // Endpoints/operationNames worth capturing — matched case-insensitively against
  // the REST path segment ("/api/<Name>") or the graphql operationName. Keeping
  // this tight is the DSGVO control: an endpoint not listed here is never teed.
  const CAPTURE_ALLOWLIST = [
    /getDrivers\b/i, // roster
    /GetEarnerMetrics\b/i, // driver performance metrics
    /GetDriverLiveLocation\b/i, // live online/offline status + waypoints
    /SearchVehicles\b/i, // fleet vehicles
    /getEarnerBreakdowns/i, // per-driver earnings breakdown
    /getSupplierBreakdown/i, // fleet-level earnings summary (cash / net roll-up)
    /GetTimelineInfo/i, // per-driver activity timeline (online/offer/assign events)
    /\bearnings\b/i, // earnings summaries
  ];

  // GraphQL operations we later REPLAY on demand (dashboard / driver page open) so
  // the data refreshes without the manager reopening the Uber page. When the page
  // makes one of these, we stash its full request body as a template.
  const REPLAY_TARGETS = ["getEarnerBreakdownsV2", "getSupplierBreakdownV2", "GetTimelineInfo"];
  function maybeStashTemplate(url, op, body) {
    if (!op || !REPLAY_TARGETS.includes(op)) return;
    if (typeof body !== "string") return;
    // Surface the request variables (esp. GetTimelineInfo's driver/time keys) so we
    // can wire precise per-driver replay — copy these from the page console.
    try {
      log(`graphql template ${op} variables:`, JSON.parse(body).variables);
    } catch {
      /* not JSON */
    }
    window.postMessage({ source: "ridy-graphql-template", operationName: op, url, body }, location.origin);
  }
  const isAllowedCapture = (u, op) => {
    const subject = op || u;
    return typeof subject === "string" && CAPTURE_ALLOWLIST.some((re) => re.test(subject));
  };
  const isCapture = (u) =>
    onSupplier && typeof u === "string" && /(\/api\/|\/graphql)/i.test(u) && !isRamen(u);
  // Prefer a graphql operationName as the kind ("getEarnerBreakdownsV2"), else the
  // REST method name from the path. Capped to the 20-char kind column.
  function kindFor(u, op) {
    if (op) return op.toLowerCase().replace(/^get/, "").slice(0, 20);
    const m = /\/api\/([A-Za-z0-9_]+)/.exec(u);
    if (m) return (m[1].toLowerCase().replace(/^get/, "") || "api").slice(0, 20);
    if (/graphql/i.test(u)) return "graphql";
    return "api";
  }
  // Pull {operationName, variables} out of a graphql request body so the server
  // knows which query it is and over what time range (earnings needs the period).
  function graphqlMeta(body) {
    try {
      const b = typeof body === "string" ? JSON.parse(body) : null;
      if (b && b.operationName) return { operationName: b.operationName, variables: b.variables ?? null };
    } catch {
      /* not JSON */
    }
    return null;
  }
  async function teeJson(res, url, meta) {
    // DSGVO allowlist gate — drop anything not explicitly captured (banking,
    // invoices, documents, …). For graphql the kind lives in the request meta.
    if (!isAllowedCapture(url, meta && meta.operationName)) return;
    try {
      const text = await res.text();
      if (!text || text.length > 1000000) return; // skip empty / very large bodies
      const data = JSON.parse(text);
      const payload = meta ? { operationName: meta.operationName, variables: meta.variables, data } : data;
      window.postMessage({ source: "ridy-capture", kind: kindFor(url, meta && meta.operationName), url, payload }, location.origin);
    } catch {
      /* non-JSON — ignore */
    }
  }
  let sawRamen = false;
  function noteRamen(via, url) {
    if (sawRamen) return;
    sawRamen = true;
    log(`seeing RAMEN traffic via ${via} (e.g. ${url}) — hook reaches Uber's requests ✓`);
  }

  // Parse one SSE "data:" line and forward any offers it contains.
  function handleData(data) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return; // keep-alive / non-JSON frame
    }
    for (const message of payload?.msg ?? []) {
      if (message.type !== "push_fleet_unified_offer") continue;
      let inner;
      try {
        inner = typeof message.msg === "string" ? JSON.parse(message.msg) : message.msg;
      } catch {
        continue;
      }
      const offers = inner?.offers ?? [];
      if (offers.length) {
        log(`captured ${offers.length} offer(s), posting to content script`);
        window.postMessage({ source: "ridy-offer", offers, seq: message.seq }, location.origin);
      }
    }
  }

  // Feed a growing text buffer, emitting each complete "data:" line.
  function makeLineParser() {
    let buffer = "";
    return (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) handleData(data);
        }
      }
    };
  }

  // ── 1) fetch ────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    const promise = origFetch.apply(this, arguments);
    if (isRamen(url)) noteRamen("fetch", url);
    if (isRecv(url)) {
      log("tapping recv via fetch:", url);
      promise
        .then((res) => tapStream(res.clone()))
        .catch(() => {});
    } else if (isCapture(url)) {
      const meta = /graphql/i.test(url) ? graphqlMeta(init && init.body) : null;
      if (meta) maybeStashTemplate(url, meta.operationName, init && typeof init.body === "string" ? init.body : null);
      promise.then((res) => teeJson(res.clone(), url, meta)).catch(() => {});
    }
    return promise;
  };

  async function tapStream(res) {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const feed = makeLineParser();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
  }

  // ── 2) XMLHttpRequest ───────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isRamen(url)) noteRamen("XHR", url);
    this.__ridyRecv = isRecv(url);
    if (this.__ridyRecv) this.__ridyUrl = url;
    this.__ridyCap = isCapture(url) && !this.__ridyRecv;
    if (this.__ridyCap) this.__ridyCapUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__ridyCap) {
      const meta = /graphql/i.test(this.__ridyCapUrl) ? graphqlMeta(body) : null;
      // DSGVO allowlist gate — same as the fetch path; drop non-listed endpoints.
      if (!isAllowedCapture(this.__ridyCapUrl, meta && meta.operationName)) {
        return origSend.apply(this, arguments);
      }
      if (meta) maybeStashTemplate(this.__ridyCapUrl, meta.operationName, typeof body === "string" ? body : null);
      this.addEventListener("load", () => {
        try {
          const text = this.responseText || "";
          if (text && text.length <= 1000000) {
            const data = JSON.parse(text);
            const payload = meta ? { operationName: meta.operationName, variables: meta.variables, data } : data;
            window.postMessage(
              { source: "ridy-capture", kind: kindFor(this.__ridyCapUrl, meta && meta.operationName), url: this.__ridyCapUrl, payload },
              location.origin,
            );
          }
        } catch {
          /* non-JSON — ignore */
        }
      });
    }
    if (this.__ridyRecv) {
      log("tapping recv via XHR:", this.__ridyUrl);
      const feed = makeLineParser();
      let seen = 0;
      this.addEventListener("progress", () => {
        // responseText holds everything so far; feed only the new tail.
        const text = this.responseText || "";
        if (text.length > seen) {
          feed(text.slice(seen));
          seen = text.length;
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  // ── 3) EventSource ──────────────────────────────────────────────────────
  const OrigES = window.EventSource;
  if (OrigES) {
    window.EventSource = function (url, config) {
      const es = new OrigES(url, config);
      if (isRamen(url)) noteRamen("EventSource", url);
      if (isRecv(url)) {
        log("tapping recv via EventSource:", url);
        es.addEventListener("message", (ev) => {
          if (ev?.data) handleData(ev.data);
        });
      }
      return es;
    };
    window.EventSource.prototype = OrigES.prototype;
    window.EventSource.CONNECTING = OrigES.CONNECTING;
    window.EventSource.OPEN = OrigES.OPEN;
    window.EventSource.CLOSED = OrigES.CLOSED;
  }

  log("network hooks installed ✓ (fetch + XHR + EventSource; waiting for the dispatch stream)");
})();
