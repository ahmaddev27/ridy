// CDP side of the co-browse channel (docs/28 §1/§2): screencast of ONE page (the login tab that
// holds the Arkose puzzle) out, mouse events in. Productionised from the Spike 0 mechanics.
//
// Scope is deliberately narrow: the CDP session is attached to the Page only (never Target.*,
// Browser.*, Network.*), the only command we ever send is Page.start/stopScreencast,
// Page.screencastFrameAck and Input.dispatchMouseEvent, and nothing the client sends can reach
// Page.navigate or Runtime.evaluate. Frames are forwarded and forgotten: never logged or stored.

import { isAllowedNavUrl, toViewportPx } from "./cobrowseGuard.js";

const SCREENCAST = { format: "jpeg", quality: 60, maxWidth: 1280, everyNthFrame: 1 };
const DROP_ACK_DELAY_MS = 150; // a dropped frame is acked late, which slows Chrome's frame production
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const MOUSE_TYPE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" };

/**
 * @param {object}   opts
 * @param {object}   opts.session       { context, page } of the pending login
 * @param {function} opts.sendFrame     (Buffer) => boolean   false = dropped (backpressure)
 * @param {function} opts.onViolation   (reason:string) => void
 * @returns {Promise<{w:number,h:number,start:function,mouse:function,stop:function}>}
 */
export async function openCdpStream({ session, sendFrame, onViolation }) {
  const { context, page } = session;
  const vp = page.viewportSize?.() ?? DEFAULT_VIEWPORT;
  const cdp = await context.newCDPSession(page);
  const guards = attachGuards(page, context, onViolation);
  let pressed = false;

  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    const ack = () => cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (sendFrame(Buffer.from(data, "base64"))) ack();
    else setTimeout(ack, DROP_ACK_DELAY_MS).unref?.();
  });

  return {
    w: vp.width,
    h: vp.height,
    start: () => cdp.send("Page.startScreencast", { ...SCREENCAST, maxHeight: vp.height }),
    mouse(kind, nx, ny) {
      const { px, py } = toViewportPx(nx, ny, vp.width, vp.height);
      if (kind === "down") pressed = true;
      const buttons = pressed ? 1 : 0; // keeps a drag a drag
      if (kind === "up") pressed = false;
      const button = kind === "move" && !buttons ? "none" : "left";
      const params = { type: MOUSE_TYPE[kind], x: px, y: py, button, buttons, clickCount: kind === "move" ? 0 : 1 };
      cdp.send("Input.dispatchMouseEvent", params).catch(() => {});
    },
    async stop() {
      guards.detach();
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
    },
  };
}

/** Navigation allowlist on the main frame; popups closed, downloads cancelled, dialogs dismissed. */
function attachGuards(page, context, onViolation) {
  const onNav = (frame) => {
    if (frame === page.mainFrame() && !isAllowedNavUrl(frame.url())) onViolation("navigation");
  };
  const onPopup = (p) => {
    if (p !== page) p.close().catch(() => {});
  };
  const onDownload = (d) => d.cancel().catch(() => {});
  const onDialog = (d) => d.dismiss().catch(() => {});
  page.on("framenavigated", onNav);
  page.on("download", onDownload);
  page.on("dialog", onDialog);
  context.on("page", onPopup);
  return {
    detach() {
      page.off("framenavigated", onNav);
      page.off("download", onDownload);
      page.off("dialog", onDialog);
      context.off("page", onPopup);
    },
  };
}
