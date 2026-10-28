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
import { startLogin, submitMfa, closeSession, STATUS } from "./browser.js";
import { adoptLogin, statusList, resumeFromDisk, startLoops } from "./persistent.js";

// loginId -> { session, companyKey, createdAt } awaiting an MFA code.
const pending = new Map();

// Drop login sessions the user abandoned so browsers don't leak. A browser that
// was already adopted into the persistent manager is NOT in this map.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (now - entry.createdAt > config.sessionTtl) {
      closeSession(entry.session);
      pending.delete(id);
    }
  }
}, 30000);

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
    await adoptLogin(String(companyKey), session, result);
    return true;
  } catch (e) {
    await closeSession(session);
    console.warn(`[server] adopt ${companyKey} failed: ${e?.message}`);
    return false;
  }
}

async function onLoginSuccess(companyKey, outcome, res) {
  // No company_key: legacy one-shot — return the capture and close the browser.
  if (!companyKey) {
    await closeSession(outcome.session);
    return send(res, 200, { status: STATUS.SUCCESS, ...outcome.result });
  }
  const adopted = await adoptOrClose(companyKey, outcome.session, outcome.result);
  if (!adopted) return send(res, 503, { status: STATUS.ERROR, message: "at_capacity" });
  return send(res, 200, { status: STATUS.SUCCESS, persistent: true, org_uuid: outcome.result?.org_uuid ?? null });
}

async function handleStart(req, res) {
  const body = await readJson(req);
  if (!body.email || !body.password) return send(res, 422, { error: "email and password required" });
  const companyKey = body.company_key != null ? String(body.company_key) : null;

  const outcome = await startLogin({ email: body.email, password: body.password });

  if (outcome.status === STATUS.MFA_REQUIRED) {
    const loginId = randomUUID();
    pending.set(loginId, { session: outcome.session, companyKey, createdAt: Date.now() });
    return send(res, 200, { status: STATUS.MFA_REQUIRED, login_id: loginId });
  }
  if (outcome.status === STATUS.SUCCESS) {
    return onLoginSuccess(companyKey, outcome, res);
  }
  return send(res, 200, { status: outcome.status, message: outcome.message });
}

async function handleMfa(req, res) {
  const body = await readJson(req);
  const entry = body.login_id ? pending.get(body.login_id) : null;
  if (!entry) return send(res, 404, { status: STATUS.ERROR, message: "unknown or expired login_id" });
  if (!body.code) return send(res, 422, { error: "code required" });

  const outcome = await submitMfa(entry.session, String(body.code));

  if (outcome.status === STATUS.SUCCESS) {
    pending.delete(body.login_id);
    return onLoginSuccess(entry.companyKey, outcome, res);
  }
  if (outcome.retry) {
    return send(res, 200, { status: STATUS.MFA_REQUIRED, login_id: body.login_id, retry: true });
  }
  pending.delete(body.login_id);
  return send(res, 200, { status: outcome.status, message: outcome.message });
}

async function handleCancel(req, res) {
  const body = await readJson(req);
  const entry = body.login_id ? pending.get(body.login_id) : null;
  if (entry) {
    await closeSession(entry.session);
    pending.delete(body.login_id);
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
    if (req.method === "GET" && req.url === "/sessions") return send(res, 200, { data: statusList() });
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok", pending: pending.size, live: statusList().length });
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(config.port, async () => {
  console.log(`Ridy uber-auth listening on :${config.port} (headful=${config.headful})`);
  startLoops();
  // Bring saved sessions back after a restart so a deploy doesn't force a fresh OTP.
  await resumeFromDisk().catch((e) => console.warn(`[server] resume failed: ${e?.message}`));
});
