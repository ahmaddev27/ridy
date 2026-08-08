// ── Ridy: RAMEN endpoint finder ─────────────────────────────────────────────
// Paste this in the browser Console on https://vsdispatch.uber.com while you
// are LOGGED IN, then wait ~20s (or click around the dispatch screen). It hooks
// fetch/XHR, catches every RAMEN request, and prints the exact URL + method +
// key headers so we can match the daemon's handshake precisely.
//
// Copy the whole "RAMEN >>" block it prints and send it back.
(() => {
  const seen = new Set();
  const isRamen = (u) => /ramen|vsdispatch|\/events\b|\/ack\b|\/recv\b/i.test(u);

  function report(method, url, headers) {
    if (seen.has(method + url)) return;
    seen.add(method + url);
    const parsed = new URL(url, location.origin);
    const params = {};
    parsed.searchParams.forEach((v, k) => (params[k] = v));
    console.log(
      "%cRAMEN >>",
      "background:#059669;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700",
      JSON.stringify(
        {
          method,
          fullUrl: url,
          path: parsed.pathname,
          host: parsed.host,
          query: params,
          interestingHeaders: headers || null,
        },
        null,
        2,
      ),
    );
  }

  // 1) Hook fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    if (url && isRamen(url)) {
      const h = {};
      const hdrs = init?.headers;
      if (hdrs) {
        (hdrs.forEach ? hdrs : new Headers(hdrs)).forEach?.((v, k) => {
          if (/uber|content-type|accept/i.test(k)) h[k] = v;
        });
      }
      report(method, url, h);
    }
    return origFetch.apply(this, arguments);
  };

  // 2) Hook XHR
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && isRamen(url)) report((method || "GET").toUpperCase(), url, null);
    return origOpen.apply(this, arguments);
  };

  // 3) Sweep already-completed requests from the Performance timeline
  performance.getEntriesByType("resource").forEach((e) => {
    if (isRamen(e.name)) report("GET", e.name, null);
  });

  console.log(
    "%cRidy: RAMEN finder armed ✓ — wait ~20s or click around the dispatch screen. Then copy every 'RAMEN >>' line.",
    "color:#059669;font-weight:700",
  );
})();
