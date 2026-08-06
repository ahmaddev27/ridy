// Driver identity finder v3 - plain ASCII, safe to paste in the console.
// Desktop-browser Uber driver dashboard.
//
// Does THREE things:
//   1. Scans data already in the page (globals + embedded JSON).
//   2. Watches new fetch/XHR requests for identity fields.
//   3. Logs api/graphql URLs (analytics noise filtered out).
//
// HOW TO USE:
//   1. On the driver dashboard, F12 -> Console. Paste ALL of this, Enter.
//   2. If it prints "HITS: N" with N>0, the data is already found.
//   3. Click around (profile / earnings / account) WITHOUT pressing F5.
//   4. Retrieve everything with:   copy(JSON.stringify(getDriverHits(), null, 2))

(function driverIdentityFinder() {
  var HITS = [];
  var HINTS = [
    "driverUUID", "driverUuid", "driver_uuid", "userUUID", "uuid",
    "firstName", "lastName", "first_name", "last_name",
    "email", "phone", "mobile", "phoneNumber",
  ];
  // URLs worth printing as REQ; analytics/telemetry are filtered out.
  var INTERESTING = /graphql|driver|profile|account|earnings|\/me\b|getDriver|partner/i;
  var NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats/i;

  function hintsIn(text) {
    if (typeof text !== "string") return [];
    var found = [];
    for (var i = 0; i < HINTS.length; i++) {
      if (text.indexOf(HINTS[i]) !== -1) found.push(HINTS[i]);
    }
    return found;
  }

  function record(source, url, body) {
    var asText = typeof body === "string" ? body : "";
    if (!asText) { try { asText = JSON.stringify(body); } catch (e) { return; } }
    var hits = hintsIn(asText);
    if (hits.length < 2) return;
    var parsed = body;
    if (typeof body === "string") { try { parsed = JSON.parse(body); } catch (e) {} }
    HITS.push({ source: source, url: url, fields: hits, body: parsed });
    console.log("=== HIT (" + source + ") fields: " + hits.join(", ") + " ===");
    console.log("URL:", url);
    console.log("BODY:", parsed);
  }

  window.getDriverHits = function () { return HITS; };

  // --- 1a. Embedded JSON in <script> tags ---
  try {
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || "";
      if (txt.length > 40 && hintsIn(txt).length >= 3) record("inline-script#" + i, location.href, txt);
    }
  } catch (e) {}

  // --- 1b. Shallow scan of window globals ---
  try {
    var keys = Object.keys(window);
    for (var j = 0; j < keys.length; j++) {
      var val;
      try { val = window[keys[j]]; } catch (e) { continue; }
      if (val && typeof val === "object") {
        var s;
        try { s = JSON.stringify(val); } catch (e) { continue; }
        if (s && s.length < 500000 && hintsIn(s).length >= 3) record("window." + keys[j], location.href, s);
      }
    }
  } catch (e) {}

  // --- 2 + 3. Watch new requests ---
  var originalFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    return originalFetch.apply(this, args).then(function (response) {
      if (INTERESTING.test(url) && !NOISE.test(url)) console.log("REQ:", url);
      try { response.clone().text().then(function (t) { record("fetch", url, t); }); } catch (e) {}
      return response;
    });
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__u = url; return originalOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener("load", function () {
      var u = xhr.__u || "";
      if (INTERESTING.test(u) && !NOISE.test(u)) console.log("REQ:", u);
      try { record("XHR", u, xhr.responseText); } catch (e) {}
    });
    return originalSend.apply(this, arguments);
  };

  console.log("FINDER ON. HITS: " + HITS.length);
  console.log("Click around (profile / earnings / account) WITHOUT F5.");
  console.log("Then run:  copy(JSON.stringify(getDriverHits(), null, 2))");
})();
