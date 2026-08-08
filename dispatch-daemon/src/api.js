// Thin client for the Ridy backend's secret-guarded internal dispatch API.

import { config } from "./config.js";

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Dispatch-Secret": config.dispatchSecret,
};

async function call(method, path, body) {
  const res = await fetch(`${config.apiBaseUrl}/api/v1/internal/dispatch${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

export const api = {
  /** Active fleet sessions with decrypted cookies. */
  async sessions() {
    return (await call("GET", "/sessions")).data;
  },

  /** Forward a batch of raw offers for ingestion (dedup/route happens server-side). */
  async ingest(offers, seq) {
    return (await call("POST", "/ingest", { offers, seq })).data;
  },

  /** Persist rolling cookies captured from Set-Cookie — keeps the session alive. */
  async refreshCookies(sessionId, cookies, expiresAt) {
    return call("POST", `/sessions/${sessionId}/cookies`, { cookies, expires_at: expiresAt });
  },

  /** Tell the backend the session was rejected so the manager is prompted to re-link. */
  async needsRelink(sessionId) {
    return call("POST", `/sessions/${sessionId}/needs-relink`);
  },

  /** Forward the driver roster pulled from supplier /api/getDrivers. */
  async roster(sessionId, drivers) {
    return call("POST", `/sessions/${sessionId}/roster`, { drivers });
  },

  /** Liveness heartbeat. */
  async heartbeat(sessionId) {
    return call("POST", `/sessions/${sessionId}/heartbeat`);
  },
};
