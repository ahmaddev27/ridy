// Reidey — dispatch-decline measurement kit. ONE paste, run in the console at
// https://vsdispatch.uber.com while logged in, during a shift with live offers.
//
// WHAT IT ANSWERS
//   1. Does a real RAMEN offer carry `offerType`?  The RejectOffers mutation needs
//      one, the repo has ZERO occurrences of the field, and our only capture used
//      "JOB" (n=1). If it is absent we must hardcode a default.
//   2. Is `realOfferUUID` always present?  The mutation needs it; the column is
//      written at DispatchOfferIngestor.php:103 and read nowhere, so production has
//      never exercised it.
//   3. What is the REAL deadline for a dispatch-side decline?  The repo assumes
//      acceptWindowInSeconds (observed 5), but nobody knows whether that is the
//      DISPATCH panel's window or the DRIVER's. The whole feature depends on it:
//        deadline ~15-20s -> a human tap inside the window is realistic
//        deadline ~4s     -> no architecture saves a human in the loop
//   4. How old is an offer when we first see it — the head start already lost before
//      any Reidey code runs.
//
// SAFETY
//   On paste it is READ-ONLY: it tees the SSE stream the panel already holds and
//   never acks, so it cannot compete with the page for seq-numbered messages (the
//   same rule as extension/inject.js). Nothing is sent to Uber until you explicitly
//   call rejectIn(), and each call arms exactly ONE offer then disarms itself before
//   the timer runs — so it can never run away and decline a series of rides.
//
// COMMANDS
//   shape()        print offer shapes + the answers to 1, 2 and 4   (read-only)
//   rejectIn(8)    decline the NEXT offer 8s after it arrives       (REAL decline)
//   disarm()       cancel a pending arm
//   deadline()     print the decline table and the bracketed deadline
//
// Suggested run: paste, wait for ~5 offers, shape(). Then rejectIn(4), wait for the
// verdict, then rejectIn(8), rejectIn(12), rejectIn(16), rejectIn(20), deadline().

(() => {
  if (window.__ridyKit) {
    console.warn("kit already loaded — reload the page before re-running.");
    return;
  }

  const GQL = "https://vsdispatch.uber.com/graphql";
  const SHAPE_MAX = 25;
  const REJECT_QUERY = [
    "mutation RejectOffers($offers: [Offer__Input]) {",
    "  rejectOffers(offers: $offers) {",
    "    offerResponse { offerUUID action driverUUID isSuccess errorMsg __typename }",
    "    __typename",
    "  }",
    "}",
    "",
  ].join("\n");

  const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

  // ---- collected state -----------------------------------------------------
  const shapes = [];         // one row per offer seen (read-only bookkeeping)
  const declines = [];       // one row per decline actually fired
  const keyUnion = new Set();
  const typeish = new Map(); // key -> Set of values, for anything type/kind/product-ish
  const envelopeTypes = new Set();
  let seen = 0;
  let armedDelayS = null;

  // ---- 1, 2, 4: the read-only answers --------------------------------------
  window.shape = () => {
    if (!shapes.length) return console.log("no offers seen yet — wait for one to arrive.");
    console.table(shapes);
    console.log("=== every top-level key seen on a real offer ===");
    console.log([...keyUnion].sort().join("\n"));
    console.log("\n=== ANSWERS ===");
    const hasType = keyUnion.has("offerType");
    console.log("1) offerType present?       ", hasType, hasType ? "" : "-> must default to JOB");
    console.log(
      "   type-ish keys found:     ",
      [...typeish].map(([k, v]) => k + "={" + [...v].join("|") + "}").join(", ") || "(none)",
    );
    const missingReal = shapes.filter((r) => !r.realOfferUUID).length;
    console.log(
      "2) realOfferUUID always set?",
      missingReal === 0,
      "(missing on " + missingReal + " of " + shapes.length + ")",
    );
    const windows = [...new Set(shapes.map((r) => r.acceptWindowS))];
    console.log(
      "3) acceptWindowInSeconds:   ",
      windows.join(", "),
      shapes.some((r) => r.acceptWindowS == null) ? "(SOMETIMES NULL)" : "",
    );
    const ages = shapes
      .map((r) => r.ageAtSeenMs)
      .filter((a) => typeof a === "number")
      .sort((a, b) => a - b);
    if (ages.length) {
      console.log(
        "4) age when first seen (ms):",
        "min " + ages[0] + " / median " + ages[Math.floor(ages.length / 2)] + " / max " + ages[ages.length - 1],
      );
    }
    console.log("   envelope message.type(s):", [...envelopeTypes].join(", "));
    console.log("\nPaste this whole output back to Claude.");
    return shapes;
  };

  // ---- 3: the deadline sweep ----------------------------------------------
  window.disarm = () => {
    armedDelayS = null;
    console.log("disarmed — nothing is pending.");
  };

  window.rejectIn = (seconds) => {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0 || s > 120) return console.log("usage: rejectIn(8)");
    armedDelayS = s;
    console.log("ARMED: the NEXT offer will be declined " + s + "s after it arrives.");
    console.log("This declines ONE real ride on your fleet. disarm() to cancel.");
  };

  window.deadline = () => {
    if (!declines.length) return console.log("nothing declined yet — call rejectIn(<seconds>).");
    console.table(declines);
    const ok = declines.filter((d) => d.isSuccess === true).map((d) => d.delayS);
    const bad = declines.filter((d) => d.isSuccess === false).map((d) => d.delayS);
    console.log("Uber ACCEPTED the decline at (s):", ok.sort((a, b) => a - b).join(", ") || "(none)");
    console.log("Uber REFUSED  the decline at (s):", bad.sort((a, b) => a - b).join(", ") || "(none)");
    if (ok.length && bad.length) {
      console.log("=> the real deadline is between " + Math.max(...ok) + "s and " + Math.min(...bad) + "s");
    } else if (ok.length) {
      console.log("=> still accepted at " + Math.max(...ok) + "s — try a LONGER delay");
    } else {
      console.log("=> already refused at " + Math.min(...bad) + "s — try a SHORTER delay");
    }
    console.log("\nPaste this whole output back to Claude.");
    return declines;
  };

  async function fireDecline(offer, delayS) {
    const params = {
      offerUUID: offer.offerUUID,
      offerType: offer.offerType ?? "JOB", // prefer the payload's own value if it has one
      realOfferUUID: offer.realOfferUUID,
    };
    const driverUUID = offer.driverInfo?.driverUUID;
    const gen = Number(offer.offerGeneratedAtMs) || null;
    const t0 = Date.now();
    let out;
    try {
      const res = await fetch(GQL, {
        method: "POST",
        mode: "cors",
        credentials: "include",
        headers: { accept: "*/*", "content-type": "application/json", "x-csrf-token": "x" },
        body: JSON.stringify({
          operationName: "RejectOffers",
          variables: { offers: [{ params, driverUUID }] },
          query: REJECT_QUERY,
        }),
      });
      const body = await res.json().catch(() => null);
      const r = body?.data?.rejectOffers?.offerResponse?.[0] ?? {};
      out = {
        httpStatus: res.status,
        isSuccess: r.isSuccess ?? null,
        errorMsg: r.errorMsg ?? (body?.errors ? JSON.stringify(body.errors).slice(0, 200) : null),
        rttMs: Date.now() - t0,
      };
    } catch (e) {
      out = { httpStatus: 0, isSuccess: null, errorMsg: String(e).slice(0, 200), rttMs: Date.now() - t0 };
    }

    const row = {
      delayS,
      // Age of the offer when Uber actually RECEIVED the decline. This is the number
      // the real deadline is measured in — not our delay, which excludes the RTT.
      offerAgeAtRejectMs: gen ? t0 - gen + out.rttMs : null,
      acceptWindowS: offer.acceptWindowInSeconds ?? null,
      offerType: "offerType" in offer ? JSON.stringify(offer.offerType) : "(ABSENT)",
      hadRealOfferUUID: Boolean(offer.realOfferUUID),
      fare: offer.formattedUFP ?? null,
      ...out,
    };
    declines.push(row);
    console.log(out.isSuccess === true ? "ACCEPTED by Uber:" : "REFUSED by Uber:", row);
    console.log("-> rejectIn(<another delay>) for the next data point, or deadline() to summarise.");
  }

  function onOffer(o) {
    if (!o || !o.offerUUID) return;

    // read-only bookkeeping
    if (seen < SHAPE_MAX) {
      Object.keys(o).forEach((k) => {
        keyUnion.add(k);
        if (/type|kind|product|flow|category/i.test(k)) {
          if (!typeish.has(k)) typeish.set(k, new Set());
          typeish.get(k).add(isScalar(o[k]) ? String(o[k]) : "(non-scalar)");
        }
      });
      const gen = Number(o.offerGeneratedAtMs) || null;
      const row = {
        n: ++seen,
        offerUUID: String(o.offerUUID).slice(0, 8),
        realOfferUUID: Boolean(o.realOfferUUID),
        offerType: "offerType" in o ? JSON.stringify(o.offerType) : "(ABSENT)",
        driverUUID: Boolean(o.driverInfo?.driverUUID),
        fare: o.formattedUFP ?? null,
        acceptWindowS: o.acceptWindowInSeconds ?? null,
        ageAtSeenMs: gen ? Date.now() - gen : null,
        keyCount: Object.keys(o).length,
      };
      shapes.push(row);
      console.log("[offer " + row.n + "]", row);
      if (row.n === 1) console.log("FULL first offer object:", JSON.parse(JSON.stringify(o)));
    }

    // the armed one-shot decline
    if (armedDelayS !== null) {
      const delayS = armedDelayS;
      armedDelayS = null; // disarm BEFORE the timer, so it can never repeat
      console.log(
        "took offer " + String(o.offerUUID).slice(0, 8) + " (fare " + o.formattedUFP + ") — declining in " + delayS + "s",
      );
      setTimeout(() => fireDecline(o, delayS), delayS * 1000);
    }
  }

  // ---- the read-only RAMEN tap --------------------------------------------
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = String((args[0] && args[0].url) || args[0] || "");
    if (!/\/ramen\w*\/events\/recv/.test(url) || !res.body) return res;

    const [mine, theirs] = res.body.tee();
    (async () => {
      const reader = mine.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const payload = JSON.parse(line.slice(5).trim());
              for (const m of payload?.msg ?? []) {
                if (m?.type) envelopeTypes.add(m.type);
                if (m?.type !== "push_fleet_unified_offer") continue;
                const inner = typeof m.msg === "string" ? JSON.parse(m.msg) : m.msg;
                (inner?.offers ?? []).forEach(onOffer);
              }
            } catch (e) {
              /* a partial frame — the next read completes it */
            }
          }
        }
      } catch (e) {
        /* stream torn down; the panel reopens it and we re-tee */
      }
    })();

    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };

  window.__ridyKit = true;
  console.log("%cReidey decline kit loaded — READ-ONLY until you call rejectIn().", "font-weight:bold");
  console.log("shape()      answers offerType / realOfferUUID / offer age   (safe)");
  console.log("rejectIn(4)  declines ONE real ride 4s after it arrives      (then 8, 12, 16, 20)");
  console.log("disarm()  ·  deadline()");
})();
