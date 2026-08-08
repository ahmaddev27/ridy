// ── Ridy: RAMEN handshake tester ────────────────────────────────────────────
// Run in the Console on https://vsdispatch.uber.com while LOGGED IN. It probes
// the RAMEN endpoints the daemon uses, in a few orders, and prints the HTTP
// status + a snippet of each response. This tells us whether the browser (real
// IP) succeeds where our server 404s, and whether /ack needs /recv opened first.
//
// Copy the whole "RAMEN TEST >>" output back.
(async () => {
  const base = "https://vsdispatch.uber.com/ramendca/events";
  const out = {};

  async function probe(name, path, { readABit = false } = {}) {
    try {
      const res = await fetch(base + path, { credentials: "include", headers: { accept: "*/*" } });
      let snippet = "";
      if (readABit && res.body) {
        // Read only the first chunk so we don't hang on the SSE stream.
        const reader = res.body.getReader();
        const { value } = await reader.read();
        snippet = new TextDecoder().decode(value || new Uint8Array()).slice(0, 200);
        reader.cancel();
      } else {
        snippet = (await res.text()).slice(0, 200);
      }
      out[name] = { path, status: res.status, ok: res.ok, snippet };
    } catch (e) {
      out[name] = { path, error: e.message };
    }
  }

  // 1) ack first (what the daemon does today)
  await probe("ack_first", "/ack?seq=0");
  // 2) recv (opens the stream / push session) — read only the first chunk
  await probe("recv", "/recv?seq=0", { readABit: true });
  // 3) ack again, now that recv has been opened once
  await probe("ack_after_recv", "/ack?seq=0");

  console.log(
    "%cRAMEN TEST >>",
    "background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700",
    JSON.stringify(out, null, 2),
  );
})();
