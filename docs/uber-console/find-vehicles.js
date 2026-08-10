// ── Reidey: vehicles endpoint finder ────────────────────────────────────────
// Paste in the browser Console on https://supplier.uber.com while LOGGED IN,
// then open the **Vehicles** section (and a driver's profile that shows their
// car). It hooks fetch + XHR, flags any response that looks like vehicle data,
// and prints the exact URL + METHOD + request BODY + the response shape (values
// redacted) so we can wire the same call server-side.
//
// HOW TO USE:
//   1. supplier.uber.com → F12 → Console → paste ALL of this → "VEHICLES WATCH ON".
//   2. Open Vehicles / Fleet / a driver's vehicle. Each match prints "VEHICLE HIT".
//   3. Copy everything:  copy(JSON.stringify(getVehicleHits(), null, 2))  → paste back.
(function vehicleFinder() {
  const HITS = [];
  window.getVehicleHits = () => HITS;

  const NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats|_static|\.js|\.css|\.svg|\.png|\.woff/i;

  // Signals that a payload is about vehicles.
  const SIGNALS = /vehicle|\bvin\b|licensePlate|license_plate|numberPlate|plate\b|\bmake\b|"model"|manufactur|registration|\bcar\b|vehicleUuid|vehicleId/i;

  function looksRelevant(text) {
    if (typeof text !== "string" || text.length < 40) return false;
    return SIGNALS.test(text);
  }

  // Keep the SHAPE, drop the sensitive values (safe to share back).
  function redact(v, depth = 0) {
    if (depth > 5) return "…";
    if (Array.isArray(v)) return v.slice(0, 2).map((x) => redact(x, depth + 1));
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).slice(0, 50)) o[k] = redact(v[k], depth + 1);
      return o;
    }
    if (typeof v === "number") return 0;
    if (typeof v === "string") return v.length > 24 ? "str" : v;
    return v;
  }

  function report(source, method, url, reqBody, respText) {
    let resp = null;
    try { resp = JSON.parse(respText); } catch {}
    let body = reqBody;
    try { body = reqBody ? JSON.parse(reqBody) : null; } catch {}
    const hit = {
      source, method, url,
      requestBody: body,
      responseKeys: resp && typeof resp === "object" ? Object.keys(resp) : null,
      responseShape: redact(resp),
    };
    HITS.push(hit);
    console.log("%cVEHICLE HIT >>", "background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700", "\n" + method + " " + url);
    console.log(hit);
    console.log("copy(JSON.stringify(getVehicleHits(), null, 2))");
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    const reqBody = init?.body && typeof init.body === "string" ? init.body : null;
    const p = origFetch.apply(this, arguments);
    if (url && !NOISE.test(url)) {
      p.then((res) => res.clone().text().then((t) => { if (looksRelevant(t)) report("fetch", method, url, reqBody, t); }).catch(() => {})).catch(() => {});
    }
    return p;
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = (m || "GET").toUpperCase(); this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener("load", () => {
      if (this.__u && !NOISE.test(this.__u) && looksRelevant(this.responseText)) {
        report("XHR", this.__m, this.__u, typeof body === "string" ? body : null, this.responseText);
      }
    });
    return os.apply(this, arguments);
  };

  console.log("%cReidey VEHICLES WATCH ON", "color:#2563eb;font-weight:700", "— open the Vehicles section / a driver's car. Then: copy(JSON.stringify(getVehicleHits(), null, 2))");
})();
