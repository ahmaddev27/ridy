// ── Reidey: driver earnings / performance / hours finder ────────────────────
// Paste in the browser Console on https://supplier.uber.com while LOGGED IN,
// then open the **Performance** / **Earnings** / **Reports** tabs (and a single
// driver's profile). It hooks fetch + XHR, flags any response that looks like
// earnings/hours/performance data, and prints the exact URL + METHOD + request
// BODY + the response's top-level keys — so we can wire the same call server-side.
//
// HOW TO USE:
//   1. supplier.uber.com → F12 → Console → paste ALL of this → "EARNINGS WATCH ON".
//   2. Click into Performance / Earnings / Reports, pick a date range, open a driver.
//   3. Each match prints "EARNINGS HIT" with url/method/body/keys.
//   4. Copy everything at once:  copy(JSON.stringify(getEarningsHits(), null, 2))
//      (send that back — it strips actual money values, keeps structure).
(function earningsFinder() {
  const HITS = [];
  window.getEarningsHits = () => HITS;

  const NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats|_static|\.js|\.css|\.svg|\.png|\.woff/i;

  // Signals that a payload is about money / time worked / performance.
  const SIGNALS = /earning|payout|payment|amount|fare|trips?\b|online.?hours|hours|acceptance|cancellation|performance|activity|balance|revenue|weekly|report/i;

  function looksRelevant(text) {
    if (typeof text !== "string" || text.length < 40) return false;
    return SIGNALS.test(text);
  }

  // Keep the SHAPE, drop the sensitive values (so it's safe to share back).
  function redact(v, depth = 0) {
    if (depth > 4) return "…";
    if (Array.isArray(v)) return v.slice(0, 2).map((x) => redact(x, depth + 1));
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).slice(0, 40)) o[k] = redact(v[k], depth + 1);
      return o;
    }
    if (typeof v === "number") return 0;
    if (typeof v === "string") return v.length > 24 ? "str" : v;
    return v;
  }

  function report(source, method, url, reqBody, respText) {
    let resp;
    try {
      resp = JSON.parse(respText);
    } catch {
      resp = null;
    }
    let body;
    try {
      body = reqBody ? JSON.parse(reqBody) : null;
    } catch {
      body = reqBody;
    }
    const hit = {
      source,
      method,
      url,
      requestBody: body,
      responseKeys: resp && typeof resp === "object" ? Object.keys(resp) : null,
      responseShape: redact(resp),
    };
    HITS.push(hit);
    console.log(
      "%cEARNINGS HIT >>",
      "background:#059669;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700",
      "\n" + method + " " + url,
    );
    console.log(hit);
    console.log("copy(JSON.stringify(getEarningsHits(), null, 2))");
  }

  // 1) fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    const reqBody = init?.body && typeof init.body === "string" ? init.body : null;
    const p = origFetch.apply(this, arguments);
    if (url && !NOISE.test(url)) {
      p.then((res) => {
        res
          .clone()
          .text()
          .then((t) => {
            if (looksRelevant(t)) report("fetch", method, url, reqBody, t);
          })
          .catch(() => {});
      }).catch(() => {});
    }
    return p;
  };

  // 2) XHR
  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__m = (m || "GET").toUpperCase();
    this.__u = u;
    return oo.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener("load", () => {
      if (this.__u && !NOISE.test(this.__u) && looksRelevant(this.responseText)) {
        report("XHR", this.__m, this.__u, typeof body === "string" ? body : null, this.responseText);
      }
    });
    return os.apply(this, arguments);
  };

  console.log(
    "%cReidey EARNINGS WATCH ON",
    "color:#059669;font-weight:700",
    "— open Performance / Earnings / Reports and a driver profile. Then: copy(JSON.stringify(getEarningsHits(), null, 2))",
  );
})();
