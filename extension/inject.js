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

  // ── Passive capture of every Uber Fleet API response ──────────────────────
  // Any supplier.uber.com /api/* or /graphql JSON the page fetches while the
  // manager browses their Uber Fleet (Documents, Earnings, Invoices, Banking, …)
  // is teed and posted to the content script, which forwards it to Reidey's
  // generic /supplier/capture. No per-page code, no reverse-engineering — every
  // tab the manager opens lands in the admin Network feed. The RAMEN recv stream
  // is excluded (handled separately as offers).
  const isCapture = (u) =>
    typeof u === "string" && /supplier\.uber\.com\/(api\/|graphql)/i.test(u) && !isRamen(u);
  function kindFor(u) {
    const m = /\/api\/([A-Za-z0-9_]+)/.exec(u);
    if (m) return (m[1].toLowerCase().replace(/^get/, "") || "api").slice(0, 20);
    if (/graphql/i.test(u)) return "graphql";
    return "api";
  }
  async function teeJson(res, url) {
    try {
      const text = await res.text();
      if (!text || text.length > 300000) return; // skip empty / very large bodies
      const payload = JSON.parse(text);
      window.postMessage({ source: "ridy-capture", kind: kindFor(url), url, payload }, location.origin);
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
      promise.then((res) => teeJson(res.clone(), url)).catch(() => {});
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
  XMLHttpRequest.prototype.send = function () {
    if (this.__ridyCap) {
      this.addEventListener("load", () => {
        try {
          const text = this.responseText || "";
          if (text && text.length <= 300000) {
            window.postMessage(
              { source: "ridy-capture", kind: kindFor(this.__ridyCapUrl), url: this.__ridyCapUrl, payload: JSON.parse(text) },
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
