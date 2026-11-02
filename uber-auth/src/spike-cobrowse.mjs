// TEMPORARY Spike 0 for docs/28 (co-browse Arkose). NOT wired into the service — a
// throwaway proof that (1) the Arkose puzzle renders over a CDP screencast and (2) Arkose
// accepts CDP-relayed mouse input so a human can solve it and the login proceeds. Delete
// after the go/no-go. Zero new deps: plain Node http, SSE for frames, POST for clicks.
//
// Run (inside a one-off container of the uber-auth image, real Chrome headed under Xvfb):
//   export DISPLAY=:99; Xvfb :99 -screen 0 1280x800x24 & sleep 2
//   PROXY_URL="<tenant-15 proxy>" SPIKE_EMAIL="ahmedkhhemaid@gmail.com" node src/spike-cobrowse.mjs
// Then tunnel the port and open the viewer in a real browser:
//   ssh -L 9000:localhost:9000 root@<vps>    # on your machine
//   open http://localhost:9000
import http from "node:http";
import { launchBrowser, newStealthContext } from "./browser.js";

const PORT = Number(process.env.SPIKE_PORT || 9000);
const PROXY_URL = process.env.PROXY_URL || null;
const EMAIL = process.env.SPIKE_EMAIL || "ahmedkhhemaid@gmail.com";
const DASH = process.env.UBER_DASHBOARD_URL || "https://vsdispatch.uber.com/";
const VW = 1280;
const VH = 800;

const log = (m) => console.log(`[spike] ${new Date().toISOString()} ${m}`);

let cdp = null;
let page = null;
let latestFrameB64 = null;
const sseClients = new Set();

function identifierField(p) {
  return p
    .getByPlaceholder(/phone number or email|telefonnummer oder e-mail/i)
    .or(p.locator('input[type="email"], input[type="tel"], input[name="identifier" i]'))
    .first();
}

async function driveToChallenge() {
  log(`launching real Chrome (proxy=${PROXY_URL ? "yes" : "NONE"})`);
  const browser = await launchBrowser();
  const context = await newStealthContext(browser, { viewport: { width: VW, height: VH } }, PROXY_URL, "spike");
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(DASH, { waitUntil: "domcontentloaded" });
  log(`landed on ${page.url()}`);

  const id = identifierField(page);
  if (await id.waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false)) {
    await id.click().catch(() => {});
    await id.fill("").catch(() => {});
    await id.pressSequentially(EMAIL, { delay: 40 });
    await page.waitForTimeout(400);
    const btn = page.getByRole("button", { name: /^weiter$|continue|next/i }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
    else await page.keyboard.press("Enter");
    log("identifier submitted; waiting for the Arkose challenge to render…");
  } else {
    log("WARN: no identifier field — maybe a remembered account; screencasting whatever is shown");
  }

  // Start the screencast of this page (the composited surface includes the Arkose OOPIF).
  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    latestFrameB64 = data;
    for (const res of sseClients) res.write(`data: ${data}\n\n`);
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId });
    } catch {
      /* page gone */
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: VW, maxHeight: VH, everyNthFrame: 1 });
  log("screencast started");

  // Watch for leaving the challenge (success signal).
  const t = setInterval(async () => {
    try {
      const url = page.url();
      const left = !/auth\.uber|\/(auth|login|oauth)/i.test(url);
      const otp = await page
        .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]')
        .first()
        .isVisible()
        .catch(() => false);
      if (left || otp) {
        log(`✅ LEFT THE CHALLENGE — ${left ? "navigated past auth" : "OTP field visible"} (url=${url})`);
        log("✅ Arkose accepted the relayed input. Spike SUCCESS.");
        clearInterval(t);
      }
    } catch {
      /* ignore */
    }
  }, 1500);
}

async function dispatchMouse(kind, nx, ny) {
  if (!cdp) return;
  const x = Math.max(0, Math.min(VW, Math.round(nx * VW)));
  const y = Math.max(0, Math.min(VH, Math.round(ny * VH)));
  const type = kind === "down" ? "mousePressed" : kind === "up" ? "mouseReleased" : "mouseMoved";
  const button = kind === "move" ? "none" : "left";
  try {
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: kind === "move" ? 0 : 1 });
  } catch (e) {
    log(`dispatch failed: ${e.message}`);
  }
}

const VIEWER = `<!doctype html><html><head><meta charset="utf-8"><title>Spike co-browse</title>
<style>body{margin:0;background:#111;color:#ccc;font:14px system-ui;text-align:center}
#c{background:#000;max-width:100vw;max-height:88vh;cursor:crosshair;touch-action:none}
#s{padding:6px}</style></head><body>
<div id="s">status: <b id="st">connecting…</b> — solve the puzzle with your mouse</div>
<canvas id="c" width="${VW}" height="${VH}"></canvas>
<script>
const c=document.getElementById('c'),ctx=c.getContext('2d'),st=document.getElementById('st');
const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height);
const es=new EventSource('/stream');
es.onopen=()=>st.textContent='live';
es.onmessage=e=>{img.src='data:image/jpeg;base64,'+e.data;};
es.onerror=()=>st.textContent='disconnected';
function send(k,ev){const r=c.getBoundingClientRect();const x=(ev.clientX-r.left)/r.width,y=(ev.clientY-r.top)/r.height;
 fetch('/click',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k,x,y})});}
c.addEventListener('mousemove',e=>send('move',e));
c.addEventListener('mousedown',e=>{e.preventDefault();send('down',e);});
window.addEventListener('mouseup',e=>send('up',e));
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(VIEWER);
  } else if (req.url === "/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("\n");
    if (latestFrameB64) res.write(`data: ${latestFrameB64}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  } else if (req.url === "/click" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { k, x, y } = JSON.parse(body);
        if (["move", "down", "up"].includes(k) && typeof x === "number" && typeof y === "number") {
          await dispatchMouse(k, x, y);
        }
      } catch {
        /* ignore */
      }
      res.writeHead(204).end();
    });
  } else {
    res.writeHead(404).end();
  }
});

server.listen(PORT, "0.0.0.0", () => log(`viewer + stream on http://localhost:${PORT}  (tunnel it, then open in a real browser)`));
driveToChallenge().catch((e) => log(`FATAL: ${e.stack || e.message}`));
