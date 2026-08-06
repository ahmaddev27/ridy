// Roster endpoint finder — captures the Uber API call that returns the LIST of
// drivers (names, photos, ids). Paste in the console on supplier.uber.com while
// viewing your drivers/team page. Plain ASCII, safe to paste.
//
// HOW TO USE:
//   1. Open supplier.uber.com and go to your Drivers / Team / Fleet page.
//   2. F12 -> Console. Paste ALL of this, press Enter -> prints "ROSTER WATCH ON".
//   3. Navigate the drivers list (open it, refresh via in-app nav, page through).
//   4. When a response with MULTIPLE drivers is seen it prints "ROSTER HIT" with
//      the URL + body. Copy them into roster-request.js and roster-response.json.
//   5. Retrieve everything any time:  copy(JSON.stringify(getRosterHits(), null, 2))

(function rosterFinder() {
  const HITS = [];
  window.getRosterHits = () => HITS;

  // A roster response mentions driverUUID/first/last several times over.
  function looksLikeRoster(text) {
    if (typeof text !== "string" || text.length < 80) return false;
    const uuidHits = (text.match(/driverUUID|driverUuid|"uuid"/gi) || []).length;
    const nameHits = (text.match(/firstName|first_name/gi) || []).length;
    return uuidHits >= 2 && nameHits >= 2; // more than one person
  }

  function report(source, url, bodyText) {
    let parsed = bodyText;
    try { parsed = JSON.parse(bodyText); } catch (e) {}
    HITS.push({ source, url, body: parsed });
    console.log("=== ROSTER HIT (" + source + ") ===");
    console.log("URL:", url);
    console.log("BODY:", parsed);
    console.log("copy(JSON.stringify(getRosterHits(), null, 2))");
  }

  const NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats/i;

  const of = window.fetch;
  window.fetch = function () {
    const a = arguments;
    const url = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || "";
    return of.apply(this, a).then((res) => {
      if (!NOISE.test(url)) {
        res.clone().text().then((t) => { if (looksLikeRoster(t)) report("fetch", url, t); }).catch(() => {});
      }
      return res;
    });
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      if (!NOISE.test(this.__u || "") && looksLikeRoster(this.responseText)) report("XHR", this.__u, this.responseText);
    });
    return os.apply(this, arguments);
  };

  console.log("ROSTER WATCH ON — open your Drivers/Team page (navigate, don't press F5).");
})();
