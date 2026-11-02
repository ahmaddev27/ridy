// Secret-guarded HTTP server that owns the live login browsers. Laravel calls
// /login/start and /login/mfa; this holds the browser between the two so the user
// can relay the MFA code. On a successful sign-in, when the caller passed a
// company_key, the browser is NOT closed — it is handed to the persistent manager
// (src/persistent.js) which keeps that company's Uber session warm 24/7, feeds the
// dispatch daemon fresh cookies, and reports per-company status to the admin. A
// login with no company_key keeps the original one-shot behaviour (capture, close).
// Uses only Node built-ins + Playwright.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { startLogin, submitMfa, closeSession, challengeTick, finishChallenge, STATUS } from "./browser.js";
import { adoptLogin, backendHasSession, liveSessionCount, statusList, resumeFromDisk, syncFromBackend, startLoops, sessionState, markLoggingIn, markNeedsOtp, handleOf } from "./persistent.js";
import { admitStart, canCobrowse, companyMatches, createStartGate } from "./loginPolicy.js";
import { createCobrowse, createCobrowseServer } from "./cobrowse.js";
import { openCdpStream } from "./cobrowseStream.js";
import { loginHash } from "./cobrowseTicket.js";

// loginId -> { session, companyKey, createdAt, passwordless } awaiting an MFA code, or (when
// `challenge` is set) parked on the Arkose puzzle for a human to solve via co-browse (docs/28).
// A challenge that ended badly keeps its entry as a tombstone (`dead` = the outcome /login/resume
// reports once) for DEAD_KEEP_MS.
const pending = new Map();
const DEAD_KEEP_MS = 120_000;
const RESUME_WAIT_MS = 25_000;
const RESUME_POLL_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The co-browse stream controller; stays null (feature off) unless COBROWSE_PORT + UBER_AUTH_SECRET are set.
let cobrowse = null;

// A passwordless attempt that ends without a capture hands the company back to
// needs_otp (markNeedsOtp only undoes LOGGING_IN, so it can never touch an active one).
function releaseLogin(entry) {
  if (entry?.passwordless && entry.companyKey) markNeedsOtp(entry.companyKey);
}

// Drop login sessions the user abandoned so browsers don't leak. A browser that
// was already adopted into the persistent manager is NOT in this map.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.dead) {
      if (now - entry.deadAt > DEAD_KEEP_MS) pending.delete(id);
    } else if (now - entry.createdAt > (entry.challenge ? config.challengeTtl : config.sessionTtl)) {
      expireEntry(id, entry);
    }
  }
}, 30000);

function expireEntry(id, entry) {
  if (!entry.challenge) {
    closeSession(entry.session);
    pending.delete(id);
    releaseLogin(entry);
    return;
  }
  cobrowse?.closeCompany(entry.companyKey, "timeout"); // its onEnd kills the login; this covers "no viewer"
  killChallenge(id, "challenge_timeout");
}

/** A challenge that cannot succeed: close the browser, free the company, remember WHY for /login/resume. */
async function killChallenge(loginId, outcome) {
  const entry = pending.get(loginId);
  if (!entry || entry.dead) return;
  entry.dead = outcome;
  entry.deadAt = Date.now();
  await closeSession(entry.session);
  releaseLogin(entry);
}

/** One pending login per company: a new start replaces (and closes) the old one. */
async function dropPendingFor(companyKey) {
  await cobrowse?.closeCompany(companyKey, "cancel");
  for (const [id, entry] of pending) {
    if (entry.companyKey === companyKey) {
      pending.delete(id);
      await closeSession(entry.session);
    }
  }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Hand a freshly logged-in session to the persistent manager. On capacity (or any
// adopt failure) the browser is closed so it never leaks. Returns true if adopted.
async function adoptOrClose(companyKey, session, result) {
  try {
    return await adoptLogin(String(companyKey), session, result);
  } catch (e) {
    await closeSession(session);
    console.warn(`[server] adopt ${companyKey} failed: ${e?.message}`);
    return null;
  }
}

async function onLoginSuccess(companyKey, outcome, res, cold = false) {
  // No company_key: legacy one-shot — return the capture and close the browser.
  if (!companyKey) {
    await closeSession(outcome.session);
    return send(res, 200, { status: STATUS.SUCCESS, ...outcome.result });
  }
  // A cold login adopts only into an EMPTY slot: if a session appeared while the code was
  // pending (re-seed / extension), ours is dropped - it must never replace a live one.
  if (cold && sessionState(String(companyKey)) != null) {
    await closeSession(outcome.session);
    return send(res, 409, { status: "session_active", message: "session_active" });
  }
  if (cold && (await backendHasSession(companyKey))) {
    await closeSession(outcome.session);
    return send(res, 409, { status: "session_active", message: "session_active" });
  }
  const adopted = await adoptOrClose(companyKey, outcome.session, outcome.result);
  if (!adopted) {
    markNeedsOtp(String(companyKey));
    return send(res, 503, { status: STATUS.ERROR, message: "at_capacity" });
  }
  // Success means the backend ACCEPTED the capture, not merely that Uber let us in.
  if (!adopted.captured) {
    return send(res, 200, { status: STATUS.CAPTURE_FAILED, message: adopted.reason ?? "not_posted" });
  }
  return send(res, 200, { status: STATUS.SUCCESS, persistent: true, org_uuid: outcome.result?.org_uuid ?? null });
}

// Tracks /login/start calls currently inside startLogin(): dropPendingFor() cannot see them.
const startGate = createStartGate({ markLoggingIn });

async function handleStart(req, res) {
  const body = await readJson(req);
  const admitted = admitStart(body, { passwordless: config.passwordless, stateOf: sessionState, coldEnabled: config.passwordlessCold });
  if (!admitted.ok) return send(res, admitted.http, admitted.body);
  const { companyKey, password } = admitted;
  const passwordless = !password;

  if (!passwordless) return runStart(body, admitted, res);

  // Everything up to markLoggingIn() is synchronous (no await between admitStart and here),
  // so nothing can flip the company to ACTIVE in the gap: a login never touches a live session.
  const entered = startGate.enter(companyKey);
  if (!entered.ok) return send(res, entered.http, entered.body);
  try {
    await dropPendingFor(companyKey);
    // Re-check after the await: an ACTIVE session (re-seeded meanwhile) is never ridden.
    if (sessionState(companyKey) === "active" || (admitted.cold && sessionState(companyKey) != null)) {
      return send(res, 409, { status: "session_active", message: "session_active" });
    }
    return await runStart(body, admitted, res);
  } catch (e) {
    markNeedsOtp(companyKey); // never leave the company stuck in logging_in
    throw e;
  } finally {
    startGate.leave(companyKey);
  }
}

// Cold browsers started but not yet visible in `pending`/the manager.
let coldStarting = 0;

/** Headed Chromes already spoken for: live sessions plus cold logins held or launching. */
function coldSlotsTaken() {
  return liveSessionCount() + coldStarting + [...pending.values()].filter((e) => e.cold && !e.dead).length;
}

async function runStart(body, admitted, res) {
  if (admitted.cold !== true) return runStartNow(body, admitted, res);
  if (coldSlotsTaken() >= config.maxSessions) return send(res, 503, { status: STATUS.ERROR, message: "at_capacity" });
  coldStarting++;
  try {
    return await runStartNow(body, admitted, res);
  } finally {
    coldStarting--;
  }
}

async function runStartNow(body, { companyKey, password, cold }, res) {
  const passwordless = !password;
  const outcome = await startLogin({
    email: body.email,
    password,
    proxyUrl: typeof body.proxy_url === "string" ? body.proxy_url : null,
    companyKey,
    // Warm re-auth: ride the company's own browser (cookies + proxy already there).
    reuse: passwordless ? handleOf(companyKey) : null,
    // Cold first connect: no handle exists by construction (state null); a fresh browser is built.
    cold: passwordless && cold === true,
    cobrowse: canCobrowse({
      requested: body.cobrowse === true,
      listening: cobrowse != null,
      secret: config.secret,
      originsConfigured: config.cobrowseAllowedOrigins.length > 0,
      proxyUrl: body.proxy_url,
      realChrome: config.realChrome,
      display: process.env.DISPLAY,
    }),
  });

  if (outcome.status === STATUS.CHALLENGE_REQUIRED) {
    const loginId = randomUUID();
    const createdAt = Date.now();
    pending.set(loginId, { session: outcome.session, companyKey, createdAt, passwordless, cold: cold === true, challenge: true });
    return send(res, 200, challengeBody(loginId, createdAt));
  }
  if (outcome.status === STATUS.MFA_REQUIRED) {
    const loginId = randomUUID();
    const createdAt = Date.now();
    pending.set(loginId, { session: outcome.session, companyKey, createdAt, passwordless, cold: cold === true });
    return send(res, 200, {
      status: STATUS.MFA_REQUIRED,
      login_id: loginId,
      channel: outcome.channel ?? "unknown",
      expires_at: new Date(createdAt + config.sessionTtl).toISOString(),
    });
  }
  if (outcome.status === STATUS.SUCCESS) {
    return onLoginSuccess(companyKey, outcome, res, cold === true);
  }
  if (passwordless) markNeedsOtp(companyKey);
  return send(res, 200, { status: outcome.status, message: outcome.message });
}

const challengeBody = (loginId, createdAt) => ({
  status: STATUS.CHALLENGE_REQUIRED,
  login_id: loginId,
  challenge: "arkose",
  expires_at: new Date(createdAt + config.challengeTtl).toISOString(),
});

const mfaBody = (loginId, createdAt) => ({
  status: STATUS.MFA_REQUIRED,
  login_id: loginId,
  channel: "unknown",
  expires_at: new Date(createdAt + config.sessionTtl).toISOString(),
});

/** How a parked challenge that ended badly is reported to /login/resume (docs/28 §3.2). */
function deadBody(outcome) {
  if (outcome === "challenge_timeout" || outcome === "challenge_failed") return { status: outcome };
  return { status: STATUS.BLOCKED, message: outcome };
}

/** Wait (long-poll) until the puzzle is left, failed, killed, or the budget is spent. */
async function awaitChallengeOutcome(entry) {
  const deadline = Date.now() + RESUME_WAIT_MS;
  while (Date.now() < deadline) {
    if (entry.dead) return "dead";
    const step = await challengeTick(entry.session).catch(() => "challenge");
    if (step !== "challenge") return step;
    await sleep(RESUME_POLL_MS);
  }
  return "challenge";
}

async function handleResume(req, res) {
  const body = await readJson(req);
  const loginId = body.login_id;
  const entry = loginId ? pending.get(loginId) : null;
  if (!entry) return send(res, 404, { status: STATUS.ERROR, message: "unknown or expired login_id" });
  if (!companyMatches(entry.companyKey, body.company_key)) {
    return send(res, 403, { status: STATUS.ERROR, message: "company_mismatch" });
  }
  if (entry.dead) return finishDead(loginId, entry, res);
  if (!entry.challenge) return send(res, 200, mfaBody(loginId, entry.createdAt)); // already past the puzzle
  if (entry.resuming) return send(res, 200, challengeBody(loginId, entry.createdAt)); // one long-poll at a time

  entry.resuming = true;
  try {
    const step = await awaitChallengeOutcome(entry);
    if (step === "dead") return finishDead(loginId, entry, res);
    if (step === "failed") {
      await killChallenge(loginId, "challenge_failed");
      return finishDead(loginId, entry, res);
    }
    if (step === "challenge") return send(res, 200, challengeBody(loginId, entry.createdAt));
    return await leaveChallenge(loginId, entry, step, res);
  } finally {
    entry.resuming = false;
  }
}

function finishDead(loginId, entry, res) {
  pending.delete(loginId);
  return send(res, 200, deadBody(entry.dead));
}

/** The puzzle was solved: close the stream FIRST, then continue to the code step / capture. */
async function leaveChallenge(loginId, entry, step, res) {
  await cobrowse?.closeCompany(entry.companyKey, "solved");
  const outcome = await finishChallenge(entry.session, step);
  if (outcome.status === STATUS.SUCCESS) {
    pending.delete(loginId);
    return onLoginSuccess(entry.companyKey, outcome, res, entry.cold === true);
  }
  if (outcome.status === STATUS.MFA_REQUIRED) {
    entry.challenge = false; // the OTP window (sessionTtl) starts now, not at the start of the puzzle
    entry.createdAt = Date.now();
    return send(res, 200, mfaBody(loginId, entry.createdAt));
  }
  if (outcome.status === STATUS.CHALLENGE_REQUIRED) return send(res, 200, challengeBody(loginId, entry.createdAt));
  pending.delete(loginId);
  releaseLogin(entry);
  if (outcome.status === STATUS.PASSKEY_UNSUPPORTED) return send(res, 200, { status: outcome.status });
  return send(res, 200, { status: STATUS.BLOCKED, message: outcome.message ?? outcome.status });
}

// Backend force-close (docs/28 §3.2): ends the live stream and cancels the parked login.
async function handleCobrowseClose(req, res) {
  const body = await readJson(req);
  if (body.company_key == null) return send(res, 422, { error: "company_key required" });
  const closed = (await cobrowse?.closeCompany(body.company_key, "cancel")) ?? false;
  const entry = body.login_id ? pending.get(body.login_id) : null;
  if (entry && !entry.dead && entry.challenge && companyMatches(entry.companyKey, body.company_key)) {
    await closeSession(entry.session);
    pending.delete(body.login_id);
    releaseLogin(entry);
  }
  return send(res, 200, { status: "closed", stream_closed: closed });
}

/** A stream ended: the login-side consequence (docs/28 §2.5). solved / viewer_closed change nothing. */
async function onStreamEnd(rec, reason) {
  const outcome = { timeout: "challenge_timeout", idle: "challenge_timeout", error: "challenge_failed", violation: "cobrowse_violation" }[reason];
  if (outcome) return killChallenge(rec.loginId, outcome);
  if (reason !== "cancel") return;
  const entry = pending.get(rec.loginId);
  if (!entry) return;
  pending.delete(rec.loginId);
  await closeSession(entry.session);
  releaseLogin(entry);
}

/** The challenge-state pending login a ticket's `lh` points at (the login_id itself never travels). */
function findChallengePending(lh) {
  for (const [loginId, entry] of pending) {
    if (entry.challenge && !entry.dead && loginHash(loginId) === lh) return { loginId, entry };
  }
  return null;
}

// The code is read, forwarded to the page and dropped: it is never logged, stored or echoed.
async function handleMfa(req, res) {
  const body = await readJson(req);
  const entry = body.login_id ? pending.get(body.login_id) : null;
  if (!entry || entry.dead) return send(res, 404, { status: STATUS.ERROR, message: "unknown or expired login_id" });
  if (!companyMatches(entry.companyKey, body.company_key)) {
    return send(res, 403, { status: STATUS.ERROR, message: "company_mismatch" });
  }
  if (entry.challenge) return send(res, 409, { status: STATUS.CHALLENGE_REQUIRED, message: "challenge_pending" });
  if (!body.code) return send(res, 422, { error: "code required" });

  console.log(`[pwless-nav] handleMfa: relaying code for login ${String(body.login_id).slice(0, 8)} (company ${entry.companyKey})`);
  const outcome = await submitMfa(entry.session, String(body.code));
  console.log(`[pwless-nav] handleMfa: submitMfa -> ${outcome.status}${outcome.retry ? " (retry)" : ""}${outcome.message ? " " + outcome.message : ""}`);

  if (outcome.status === STATUS.SUCCESS) {
    pending.delete(body.login_id);
    return onLoginSuccess(entry.companyKey, outcome, res, entry.cold === true);
  }
  if (outcome.retry) {
    return send(res, 200, { status: STATUS.MFA_REQUIRED, login_id: body.login_id, retry: true, channel: outcome.channel ?? "unknown", switched: outcome.switched === true });
  }
  pending.delete(body.login_id);
  releaseLogin(entry);
  return send(res, 200, { status: outcome.status, message: outcome.message });
}

async function handleCancel(req, res) {
  const body = await readJson(req);
  const entry = body.login_id ? pending.get(body.login_id) : null;
  if (entry && companyMatches(entry.companyKey, body.company_key)) {
    await closeSession(entry.session);
    pending.delete(body.login_id);
    releaseLogin(entry);
  }
  return send(res, 200, { status: "cancelled" });
}

const server = createServer(async (req, res) => {
  if (req.headers["x-auth-secret"] !== config.secret) {
    return send(res, 401, { error: "unauthorized" });
  }
  try {
    if (req.method === "POST" && req.url === "/login/start") return await handleStart(req, res);
    if (req.method === "POST" && req.url === "/login/mfa") return await handleMfa(req, res);
    if (req.method === "POST" && req.url === "/login/cancel") return await handleCancel(req, res);
    if (req.method === "POST" && req.url === "/login/resume") return await handleResume(req, res);
    if (req.method === "POST" && req.url === "/cobrowse/close") return await handleCobrowseClose(req, res);
    if (req.method === "GET" && req.url === "/sessions") return send(res, 200, { data: statusList() });
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok", pending: pending.size, live: statusList().length });
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

// Second listener (docs/28 §2.4): WebSocket upgrade on /cobrowse/ws only. It exists only when the
// feature is configured; otherwise an Arkose challenge stays blocked(arkose) as before.
if (config.cobrowsePort && config.secret && config.cobrowseAllowedOrigins.length) {
  cobrowse = createCobrowse({
    secret: config.secret,
    allowedOrigins: config.cobrowseAllowedOrigins,
    max: config.cobrowseMax,
    findPending: findChallengePending,
    openStream: openCdpStream,
    tick: challengeTick,
    onEnd: onStreamEnd,
  });
  createCobrowseServer(cobrowse).listen(config.cobrowsePort, () =>
    console.log(`Ridy uber-auth co-browse WS on :${config.cobrowsePort} (max=${config.cobrowseMax})`),
  );
}

server.listen(config.port, async () => {
  console.log(`Ridy uber-auth listening on :${config.port} (headful=${config.headful})`);
  startLoops();
  // Bring saved sessions back after a restart (fast, from disk), then reconcile
  // with the backend: seed a browser for every active connected company that has
  // none yet, from the session it connected on Uber — no password, no user step.
  await resumeFromDisk().catch((e) => console.warn(`[server] resume failed: ${e?.message}`));
  await syncFromBackend().catch((e) => console.warn(`[server] initial sync failed: ${e?.message}`));
});
