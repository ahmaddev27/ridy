// Runs in the PAGE's main world (injected by content.js) so it can wrap the
// page's own window.fetch. Uber's dispatch UI streams offers over RAMEN via
// fetch; we passively tee each recv response and post the offers to the content
// script. We never read the original body or send acks, so Uber's page keeps
// working normally and we don't compete for the seq-numbered messages.
(() => {
  const log = (...a) => console.log("%c[Ridy inject]", "color:#059669;font-weight:700", ...a);

  if (window.__ridyInjected) {
    log("already installed, skipping");
    return;
  }
  window.__ridyInjected = true;

  const origFetch = window.fetch;
  const isRecv = (u) => typeof u === "string" && /\/ramen\w*\/events\/recv/i.test(u);

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    const promise = origFetch.apply(this, arguments);

    if (isRecv(url)) {
      log("tapping recv stream:", url);
      promise
        .then((res) => {
          // clone() tees the stream: the page reads the original, we read the copy.
          try {
            tap(res.clone());
          } catch (e) {
            log("clone failed:", e.message);
          }
        })
        .catch(() => {});
    }
    return promise;
  };

  log("fetch hook installed ✓ (waiting for the dispatch stream)");

  async function tap(res) {
    if (!res.body) return;
    const reader = res.body.getReader();
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
          continue; // keep-alive / non-JSON frame
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
            log(`captured ${offers.length} offer(s) from stream, posting to content script`);
            window.postMessage({ source: "ridy-offer", offers, seq: message.seq }, "*");
          }
        }
      }
    }
  }
})();
