import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createJtiStore, deriveKey, loginHash, signTicket, verifyTicket } from "../src/cobrowseTicket.js";
import { auditLine, createRateLimiter, isAllowedNavUrl, parseAuth, parseKey, parseMouse, toViewportPx } from "../src/cobrowseGuard.js";
import { createCobrowse, createCobrowseServer } from "../src/cobrowse.js";

const SECRET = "test-secret";
const KEY = deriveKey(SECRET);
const ORIGIN = "https://reidey.de";
const NOW_S = 1_800_000_000;

const payload = (over = {}) => ({ tid: 7, sid: "sid-1", lh: loginHash("login-1"), uid: 3, jti: "jti-1", exp: NOW_S + 60, ...over });
const verify = (token, over = {}) =>
  verifyTicket(token, { key: KEY, nowS: NOW_S, jtis: createJtiStore(), origin: ORIGIN, allowedOrigins: [ORIGIN], ...over });

// --- ticket ---------------------------------------------------------------------------
test("ticket: a fresh signed ticket verifies", () => {
  const r = verify(signTicket(payload(), KEY));
  assert.equal(r.ok, true);
  assert.equal(r.payload.tid, 7);
});

test("ticket: expired is rejected", () => {
  assert.equal(verify(signTicket(payload({ exp: NOW_S - 1 }), KEY)).reason, "expired");
});

test("ticket: a ticket living longer than ~60s is rejected", () => {
  assert.equal(verify(signTicket(payload({ exp: NOW_S + 600 }), KEY)).reason, "ttl_too_long");
});

test("ticket: wrong key / tampered payload fails the signature", () => {
  assert.equal(verify(signTicket(payload(), deriveKey("other"))).reason, "bad_signature");
  const [body, sig] = signTicket(payload(), KEY).split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload(), tid: 8 })).toString("base64url");
  assert.equal(verify(`${forged}.${sig}`).reason, "bad_signature");
  assert.ok(body);
});

test("ticket: the key is domain separated from the raw secret", () => {
  assert.notEqual(KEY.toString("hex"), Buffer.from(SECRET).toString("hex"));
  assert.equal(verify(signTicket(payload(), Buffer.from(SECRET))).reason, "bad_signature");
});

test("ticket: jti is single use", () => {
  const jtis = createJtiStore();
  const t = signTicket(payload(), KEY);
  assert.equal(verify(t, { jtis }).ok, true);
  assert.equal(verify(t, { jtis }).reason, "reused");
});

test("ticket: Origin must be allow-listed", () => {
  const t = signTicket(payload(), KEY);
  assert.equal(verify(t, { origin: "https://evil.example" }).reason, "origin");
  assert.equal(verify(t, { origin: undefined }).reason, "origin");
  assert.equal(verify(t, { allowedOrigins: [] }).reason, "origin");
});

test("ticket: a rejected attempt does not burn the jti", () => {
  const jtis = createJtiStore();
  const t = signTicket(payload(), KEY);
  assert.equal(verify(t, { jtis, origin: "https://evil.example" }).reason, "origin");
  assert.equal(verify(t, { jtis }).ok, true);
});

test("ticket: garbage is bad_ticket", () => {
  for (const g of ["", "x", "a.b", null, 5]) assert.equal(verify(g).reason, g === "a.b" ? "bad_ticket" : "bad_ticket");
});

// --- guard ----------------------------------------------------------------------------
test("guard: only the two fixed client messages parse", () => {
  assert.equal(parseAuth('{"t":"auth","ticket":"abc"}'), "abc");
  assert.equal(parseAuth('{"t":"auth","ticket":"abc","x":1}'), null);
  assert.deepEqual(parseMouse('{"t":"m","k":"down","x":0.5,"y":1}'), { k: "down", x: 0.5, y: 1 });
  for (const bad of [
    '{"t":"m","k":"wheel","x":0.5,"y":0.5}',
    '{"t":"m","k":"move","x":1.5,"y":0.5}',
    '{"t":"m","k":"move","x":"0.5","y":0.5}',
    '{"t":"key","k":"a"}',
    '{"t":"m","k":"move","x":0.5,"y":0.5,"button":"right"}',
    '{"t":"navigate","url":"https://evil"}',
    "[]",
    "not json",
  ]) assert.equal(parseMouse(bad), null, bad);
});

test("guard: keyboard (fullLogin) parses a printable char and a whitelisted key only", () => {
  assert.deepEqual(parseKey('{"t":"k","c":"a"}'), { kind: "char", c: "a" });
  assert.deepEqual(parseKey('{"t":"k","c":"@"}'), { kind: "char", c: "@" });
  assert.deepEqual(parseKey('{"t":"k","c":"ä"}'), { kind: "char", c: "ä" });
  const bs = parseKey('{"t":"k","n":"Backspace"}');
  assert.equal(bs.kind, "key");
  assert.equal(bs.name, "Backspace");
  assert.equal(bs.vk, 8);
  for (const bad of [
    '{"t":"k","c":"ab"}', // more than one char
    '{"t":"k","c":""}', // empty
    '{"t":"k","c":"\\u0003"}', // a control char (Ctrl-C)
    '{"t":"k","c":"\\u007f"}', // DEL
    '{"t":"k","n":"Control"}', // modifier, not whitelisted
    '{"t":"k","n":"F5"}', // function key, not whitelisted
    '{"t":"k","n":"a"}', // not a named key
    '{"t":"k","c":"a","n":"Enter"}', // extra key
    '{"t":"k","c":"a","ctrl":true}', // smuggled modifier
    '{"t":"k"}', // nothing to type
    '{"t":"key","c":"a"}', // wrong type tag
    '{"t":"m","k":"down","x":0,"y":0}', // a mouse message is not a key
  ]) assert.equal(parseKey(bad), null, bad);
});

test("guard: normalised coordinates clamp to the viewport", () => {
  assert.deepEqual(toViewportPx(0, 0, 1280, 800), { px: 0, py: 0 });
  assert.deepEqual(toViewportPx(1, 1, 1280, 800), { px: 1279, py: 799 });
});

test("guard: rate limiter trips past 120/s and resets next window", () => {
  let t = 5000;
  const l = createRateLimiter({ now: () => t });
  for (let i = 0; i < 120; i++) assert.equal(l.allow(), true);
  assert.equal(l.allow(), false);
  t += 1000;
  assert.equal(l.allow(), true);
});

test("guard: navigation allowlist", () => {
  for (const ok of ["https://auth.uber.com/login", "https://uber.com/", "https://client-api.arkoselabs.com/x", "about:blank"]) assert.equal(isAllowedNavUrl(ok), true, ok);
  for (const bad of ["https://evil.example/", "https://uber.com.evil.example/", "http://auth.uber.com/", "file:///etc/passwd", "javascript:1", "garbage"]) assert.equal(isAllowedNavUrl(bad), false, bad);
});

test("audit: only whitelisted fields can ever be logged", () => {
  const line = auditLine("cobrowse.closed", { tid: 7, uid: 3, durationMs: 10, reason: "solved", frames: 4, x: 1, y: 2, frame: "AAAA", screenshot: "BBBB" });
  assert.match(line, /"frames":4/);
  assert.doesNotMatch(line, /AAAA|BBBB|"x"|"y"/);
});

// --- websocket integration (no browser: stream + tick are injected) ---------------------
async function harness({ max = 3, entryCompany = "7", fullLogin = false } = {}) {
  const log = { mouse: [], keys: [], ended: [], audit: [], stopped: 0, opened: 0 };
  const entry = { companyKey: entryCompany, session: {}, challenge: true, fullLogin };
  let tickResult = "challenge";
  const cobrowse = createCobrowse({
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    max,
    findPending: (lh) => (lh === loginHash("login-1") ? { loginId: "login-1", entry } : null),
    openStream: async () => {
      log.opened++;
      return { w: 1280, h: 800, start: async () => {}, mouse: (k, x, y) => log.mouse.push([k, x, y]), key: (k) => log.keys.push(k), stop: async () => { log.stopped++; } };
    },
    tick: async () => tickResult,
    onEnd: async (_rec, reason) => log.ended.push(reason),
    audit: (l) => log.audit.push(l),
  });
  const server = createCobrowseServer(cobrowse);
  server.listen(0);
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/cobrowse/ws`;
  return { log, url, cobrowse, setTick: (v) => (tickResult = v), close: () => server.close() };
}

function connect(url, origin = ORIGIN) {
  const ws = new WebSocket(url, { origin });
  const messages = [];
  ws.on("message", (d, bin) => messages.push(bin ? "<bin>" : d.toString()));
  const closed = new Promise((r) => ws.on("close", (code, reason) => r({ code, reason: reason.toString() })));
  ws.on("error", () => {});
  return { ws, messages, closed, opened: once(ws, "open") };
}

const ticket = (over = {}) =>
  signTicket({ tid: 7, sid: "sid-" + Math.random(), lh: loginHash("login-1"), uid: 3, jti: "jti-" + Math.random(), exp: Math.floor(Date.now() / 1000) + 60, ...over }, KEY);

async function authed(h, over = {}) {
  const c = connect(h.url);
  await c.opened;
  c.ws.send(JSON.stringify({ t: "auth", ticket: ticket(over) }));
  await new Promise((r) => setTimeout(r, 60));
  return c;
}

test("ws: a good ticket opens the stream, relays mouse, and says hello", async () => {
  const h = await harness();
  const c = await authed(h);
  assert.deepEqual(c.messages, ['{"t":"hello","w":1280,"h":800}']);
  c.ws.send('{"t":"m","k":"down","x":0.25,"y":0.5}');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(h.log.mouse, [["down", 0.25, 0.5]]);
  c.ws.close();
  await c.closed;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.log.stopped, 1);
  assert.ok(h.log.audit.some((l) => l.includes("cobrowse.opened")) && h.log.audit.some((l) => l.includes("cobrowse.closed")));
  h.close();
});

test("ws: a fullLogin stream relays whitelisted keystrokes to the page", async () => {
  const h = await harness({ fullLogin: true });
  const c = await authed(h);
  c.ws.send('{"t":"k","c":"a"}');
  c.ws.send('{"t":"k","n":"Enter"}');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(h.log.keys.length, 2);
  assert.deepEqual(h.log.keys[0], { kind: "char", c: "a" });
  assert.equal(h.log.keys[1].kind, "key");
  assert.equal(h.log.keys[1].name, "Enter");
  assert.equal(h.log.ended.length, 0); // still live
  c.ws.close();
  h.close();
});

test("ws: a fullLogin stream still rejects a non-whitelisted key as a violation", async () => {
  const h = await harness({ fullLogin: true });
  const c = await authed(h);
  c.ws.send('{"t":"k","n":"Control"}');
  await c.closed;
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(h.log.ended, ["violation"]);
  assert.equal(h.log.keys.length, 0);
  h.close();
});

test("ws: an Arkose (non-fullLogin) stream rejects ALL keyboard input as a violation", async () => {
  const h = await harness(); // fullLogin defaults to false
  const c = await authed(h);
  c.ws.send('{"t":"k","c":"a"}');
  await c.closed;
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(h.log.ended, ["violation"]);
  assert.equal(h.log.keys.length, 0);
  h.close();
});

test("ws: wrong Origin never upgrades", async () => {
  const h = await harness();
  const c = connect(h.url, "https://evil.example");
  await assert.rejects(c.opened);
  h.close();
});

test("ws: reused jti, expired and company_mismatch tickets are refused with 4401", async () => {
  const h = await harness();
  const jti = "same-jti";
  const first = await authed(h, { jti });
  first.ws.close();
  await first.closed;
  const reused = connect(h.url);
  await reused.opened;
  reused.ws.send(JSON.stringify({ t: "auth", ticket: ticket({ jti }) }));
  assert.deepEqual(await reused.closed, { code: 4401, reason: "reused" });

  const expired = connect(h.url);
  await expired.opened;
  expired.ws.send(JSON.stringify({ t: "auth", ticket: ticket({ exp: Math.floor(Date.now() / 1000) - 5 }) }));
  assert.deepEqual(await expired.closed, { code: 4401, reason: "expired" });

  const other = connect(h.url);
  await other.opened;
  other.ws.send(JSON.stringify({ t: "auth", ticket: ticket({ tid: 99 }) }));
  assert.deepEqual(await other.closed, { code: 4401, reason: "company_mismatch" });
  h.close();
});

test("ws: unknown login (no pending challenge) is refused", async () => {
  const h = await harness();
  const c = connect(h.url);
  await c.opened;
  c.ws.send(JSON.stringify({ t: "auth", ticket: ticket({ lh: loginHash("nope") }) }));
  assert.deepEqual(await c.closed, { code: 4401, reason: "no_pending" });
  h.close();
});

test("ws: one viewer per sid and per company; global cap", async () => {
  const h = await harness();
  const a = await authed(h);
  const second = connect(h.url);
  await second.opened;
  second.ws.send(JSON.stringify({ t: "auth", ticket: ticket() }));
  assert.deepEqual(await second.closed, { code: 4409, reason: "already_live" });
  a.ws.close();
  h.close();

  const capped = await harness({ max: 0 });
  const c = connect(capped.url);
  await c.opened;
  c.ws.send(JSON.stringify({ t: "auth", ticket: ticket() }));
  assert.deepEqual(await c.closed, { code: 4429, reason: "capacity" });
  capped.close();
});

test("ws: an off-schema message closes the socket (and ends the stream)", async () => {
  for (const bad of ['{"t":"key","k":"a"}', '{"t":"m","k":"wheel","x":0,"y":0}', "garbage", '{"t":"navigate","url":"https://x"}']) {
    const h = await harness();
    const c = await authed(h);
    c.ws.send(bad);
    const closed = await c.closed;
    assert.equal(closed.code, 1000, bad);
    assert.ok(c.messages.includes('{"t":"end","reason":"violation"}'), bad);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(h.log.ended, ["violation"]);
    assert.equal(h.log.stopped, 1);
    h.close();
  }
});

test("ws: a binary client message and an oversize one close the socket", async () => {
  const h = await harness();
  const c = await authed(h);
  c.ws.send(Buffer.from([1, 2, 3]));
  assert.equal((await c.closed).code, 1000);
  const h2 = await harness();
  const c2 = await authed(h2);
  c2.ws.send(JSON.stringify({ t: "m", k: "move", x: 0.1, y: 0.1, pad: "x".repeat(300) }));
  await c2.closed;
  assert.deepEqual(h2.log.ended, ["violation"]);
  h.close();
  h2.close();
});

test("ws: more than 120 messages in one second trips the rate limit", async () => {
  const h = await harness();
  const c = await authed(h);
  for (let i = 0; i < 160; i++) c.ws.send('{"t":"m","k":"move","x":0.5,"y":0.5}');
  await c.closed;
  assert.deepEqual(h.log.ended, ["violation"]);
  assert.ok(h.log.mouse.length <= 120);
  h.close();
});

test("ws: leaving the challenge ends the stream with 'solved' before anything else", async () => {
  const h = await harness();
  const c = await authed(h);
  h.setTick("otp");
  const closed = await c.closed;
  assert.equal(closed.code, 1000);
  assert.ok(c.messages.includes('{"t":"end","reason":"solved"}'));
  assert.deepEqual(h.log.ended, ["solved"]);
  assert.equal(h.log.stopped, 1);
  h.close();
});

test("ws: repeated Arkose failure ends the stream as an error", async () => {
  const h = await harness();
  const c = await authed(h);
  h.setTick("failed");
  await c.closed;
  assert.deepEqual(h.log.ended, ["error"]);
  h.close();
});

test("ws: closeCompany force-closes with 'cancel'", async () => {
  const h = await harness();
  const c = await authed(h);
  assert.equal(await h.cobrowse.closeCompany("7", "cancel"), true);
  await c.closed;
  assert.deepEqual(h.log.ended, ["cancel"]);
  assert.equal(await h.cobrowse.closeCompany("7", "cancel"), false);
  h.close();
});

test("ws: only /cobrowse/ws upgrades; plain HTTP is 404", async () => {
  const h = await harness();
  const bad = connect(h.url.replace("/cobrowse/ws", "/other"));
  await assert.rejects(bad.opened);
  const res = await fetch(h.url.replace("ws://", "http://").replace("/cobrowse/ws", "/login/start"), { method: "POST" });
  assert.equal(res.status, 404);
  h.close();
});
