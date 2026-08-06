// Secret-guarded HTTP server that owns the live login browsers. Laravel calls
// /login/start and /login/mfa; this holds the browser between the two so the
// user can relay the MFA code. Uses only Node built-ins + Playwright.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { startLogin, submitMfa, closeSession, STATUS } from "./browser.js";

// loginId -> held Playwright session awaiting an MFA code.
const pending = new Map();

// Drop sessions the user abandoned so browsers don't leak.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of pending) {
    if (now - session.createdAt > config.sessionTtl) {
      closeSession(session);
      pending.delete(id);
    }
  }
}, 30000);

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
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

async function handleStart(req, res) {
  const body = await readJson(req);
  if (!body.email || !body.password) return send(res, 422, { error: "email and password required" });

  const outcome = await startLogin({ email: body.email, password: body.password });

  if (outcome.status === STATUS.MFA_REQUIRED) {
    const loginId = randomUUID();
    pending.set(loginId, outcome.session);
    return send(res, 200, { status: STATUS.MFA_REQUIRED, login_id: loginId });
  }

  if (outcome.status === STATUS.SUCCESS) {
    return send(res, 200, { status: STATUS.SUCCESS, ...outcome.result });
  }

  return send(res, 200, { status: outcome.status, message: outcome.message });
}

async function handleMfa(req, res) {
  const body = await readJson(req);
  const session = body.login_id ? pending.get(body.login_id) : null;
  if (!session) return send(res, 404, { status: STATUS.ERROR, message: "unknown or expired login_id" });
  if (!body.code) return send(res, 422, { error: "code required" });

  const outcome = await submitMfa(session, String(body.code));

  if (outcome.status === STATUS.SUCCESS) {
    pending.delete(body.login_id);
    return send(res, 200, { status: STATUS.SUCCESS, ...outcome.result });
  }
  if (outcome.retry) {
    return send(res, 200, { status: STATUS.MFA_REQUIRED, login_id: body.login_id, retry: true });
  }

  pending.delete(body.login_id);
  return send(res, 200, { status: outcome.status, message: outcome.message });
}

async function handleCancel(req, res) {
  const body = await readJson(req);
  const session = body.login_id ? pending.get(body.login_id) : null;
  if (session) {
    await closeSession(session);
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
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok", pending: pending.size });
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(config.port, () => {
  console.log(`Ridy uber-auth listening on :${config.port} (headful=${config.headful})`);
});
