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
    const error = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    // Callers branch on these: the ingest queue retries only transient statuses,
    // and a 409 stale_jar tells a stream a reconnect replaced its cookie jar.
    error.status = res.status;
    error.apiMessage = apiMessage(text);
    throw error;
  }
  return res.json();
}

function apiMessage(text) {
  try {
    const message = JSON.parse(text)?.message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

/** The backend refused a report from a stream whose cookie jar a reconnect replaced. */
export function isStaleJar(error) {
  return error?.status === 409 && error?.apiMessage === "stale_jar";
}

/** The jar generation a stream runs on, echoed so the backend can refuse stale writes. */
function jarBody(jarVersion) {
  return Number.isInteger(jarVersion) ? { jar_version: jarVersion } : {};
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
  async refreshCookies(sessionId, cookies, expiresAt, jarVersion) {
    return call("POST", `/sessions/${sessionId}/cookies`, { cookies, expires_at: expiresAt, ...jarBody(jarVersion) });
  },

  /** Tell the backend the session was rejected so the manager is prompted to re-link. */
  async needsRelink(sessionId, jarVersion) {
    return call("POST", `/sessions/${sessionId}/needs-relink`, jarBody(jarVersion));
  },

  /** Fleet Hub polls are failing but the offer stream is alive: prompt a reconnect
   *  WITHOUT flagging the session broken (so the offer stream keeps running). */
  async supplierDegraded(sessionId, jarVersion) {
    return call("POST", `/sessions/${sessionId}/supplier-degraded`, jarBody(jarVersion));
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
