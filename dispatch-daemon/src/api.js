// Thin client for the Ridy backend's secret-guarded internal dispatch API.

import { config } from "./config.js";

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Dispatch-Secret": config.dispatchSecret,
  // Identifies this daemon box so the backend returns only its assigned companies.
  "X-Shard-Id": config.shardId,
};

async function call(method, path, body) {
  const res = await fetch(`${config.apiBaseUrl}/api/v1/internal/dispatch${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // fetch has no default timeout: without this a backend that accepts the
    // connection but never answers parks the promise forever (a stalled status
    // chain, a never-settling ingest). Callers decide what a rejection means:
    // ingests are retried by the stream's queue, polls/heartbeats retry next cycle.
    signal: AbortSignal.timeout(config.apiTimeout),
  });
  if (!res.ok) {
    // Bounded: an HTML error page (Caddy 503 during a deploy) would otherwise
    // flood the logs and Sentry with kilobytes per failure.
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const api = {
  /** Active fleet sessions with decrypted cookies. */
  async sessions() {
    const body = await call("GET", "/sessions");
    return { sessions: body.data, globalProxyUrl: body.meta?.global_proxy_url || "" };
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

  /** Fleet Hub polls are failing but the offer stream is alive: prompt a reconnect
   *  WITHOUT flagging the session broken (so the offer stream keeps running). */
  async supplierDegraded(sessionId) {
    return call("POST", `/sessions/${sessionId}/supplier-degraded`);
  },

  /** Forward the driver roster pulled from supplier /api/getDrivers. */
  async roster(sessionId, drivers) {
    return call("POST", `/sessions/${sessionId}/roster`, { drivers });
  },

  /** Forward live driver statuses pulled from supplier GetDriverLiveLocation. */
  async statuses(sessionId, statuses) {
    return call("POST", `/sessions/${sessionId}/statuses`, { statuses });
  },

  /** Liveness heartbeat. */
  async heartbeat(sessionId) {
    return call("POST", `/sessions/${sessionId}/heartbeat`);
  },
};
