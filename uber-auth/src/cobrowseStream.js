// CDP side of the co-browse channel (docs/28 §1/§2): screencast of ONE page (the login tab that
// holds the Arkose puzzle) out, mouse events in. Productionised from the Spike 0 mechanics.
//
// Scope is deliberately narrow: the CDP session is attached to the Page only (never Target.*,
// Browser.*, Network.*), the only commands we ever send are Page.start/stopScreencast,
// Page.screencastFrameAck, Input.dispatchMouseEvent and — in fullLogin mode only (docs/28 §11) —
// Input.dispatchKeyEvent for a whitelisted key or a single character. Nothing the client sends can
// reach Page.navigate or Runtime.evaluate. Frames are forwarded and forgotten: never logged/stored.

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
    // fullLogin mode only (docs/28 §11): one parsed keystroke -> a keyDown+keyUp pair. A character
    // carries `text` (so React controlled inputs update); a named key carries the virtual-key code.
    // The caller only reaches this when the stream is in fullLogin mode; never in Arkose mode.
    key(k) {
      const press = (extra) => {
        cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...extra }).catch(() => {});
        cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...extra }).catch(() => {});
      };
      if (k.kind === "char") return press({ text: k.c, key: k.c });
      press({ key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
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
