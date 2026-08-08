// Holds one fleet's RAMEN dispatch stream: handshake, read SSE, forward offers,
// and persist rolling cookies so an actively-used session outlives its idle TTL.

import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { api } from "./api.js";

export class RamenStream {
  constructor(session) {
    this.session = session; // { id, tenant_id, uber_org_uuid, cookies: [{name,value}] }
    this.jar = new Map(session.cookies.map((c) => [c.name, c.value]));
    this.seq = 0;
    this.stopped = false;
    this.reconnectDelay = config.reconnectMinDelay;
    // A stable device id per stream, mirroring the browser client's headers.
    this.deviceId = `vs_dispatch-${randomUUID()}`;
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    if (this.rosterTimer) clearInterval(this.rosterTimer);
  }

  /** Fetch the fleet's driver roster from supplier /api/getDrivers and forward it. */
  async syncRoster() {
    try {
      const res = await fetch(`${config.uberSupplierBase}/api/getDrivers?localeCode=en`, {
        headers: { ...this.headers(), accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`[${this.tag()}] roster fetch -> ${res.status}`);
        return;
      }
      const body = await res.json();
      const drivers = body?.data?.drivers ?? [];
      if (drivers.length === 0) return;

      const result = await api.roster(this.session.id, drivers);
      console.log(`[${this.tag()}] roster synced: ${drivers.length} drivers`, result);
    } catch (e) {
      console.error(`[${this.tag()}] roster sync failed: ${e.message}`);
    }
  }

  headers() {
    return {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "x-uber-client-name": "vs_dispatch",
      "x-uber-client-session": randomUUID(),
      "x-uber-client-version": "1.0.0",
      "x-uber-device": "web",
      "x-uber-device-id": this.deviceId,
      cookie: [...this.jar].map(([n, v]) => `${n}=${v}`).join("; "),
    };
  }

  url(path, seq) {
    return `${config.uberDispatchBase}${config.ramenPath}${path}?seq=${seq}`;
  }

  /** Merge any Set-Cookie from a response into the jar, then persist to backend. */
  async absorbCookies(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length === 0) return;

    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }

    const cookies = [...this.jar].map(([name, value]) => ({ name, value }));
    await api.refreshCookies(this.session.id, cookies).catch((e) =>
      console.error(`[${this.tag()}] cookie refresh failed: ${e.message}`),
    );
  }

  tag() {
    return `session ${this.session.id}/${this.session.uber_org_uuid.slice(0, 8)}`;
  }

  /** True if Uber rejected the session (auth lapsed) — the manager must re-link. */
  async handleAuthFailure(status) {
    if (status === 401 || status === 403) {
      console.warn(`[${this.tag()}] auth rejected (${status}) -> needs relink`);
      await api.needsRelink(this.session.id).catch(() => {});
      this.stop();
      return true;
    }
    return false;
  }

  async run() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (e) {
        if (this.stopped) break;
        console.error(`[${this.tag()}] stream error: ${e.message}`);
      }
      if (this.stopped) break;
      await this.backoff();
    }
  }

  async connectOnce() {
    this.controller = new AbortController();

    // 1. Handshake.
    const ack = await fetch(this.url("/ack", -1), { headers: this.headers(), signal: this.controller.signal });
    if (await this.handleAuthFailure(ack.status)) return;
    if (!ack.ok) throw new Error(`ack -> ${ack.status}`);
    await this.absorbCookies(ack);

    // 2. Open the stream, resuming from the last seq we saw.
    const recv = await fetch(this.url("/recv", this.seq), { headers: this.headers(), signal: this.controller.signal });
    if (await this.handleAuthFailure(recv.status)) return;
    if (!recv.ok) throw new Error(`recv -> ${recv.status}`);
    await this.absorbCookies(recv);

    console.log(`[${this.tag()}] stream open (seq ${this.seq})`);
    this.reconnectDelay = config.reconnectMinDelay; // reset backoff on success

    // Pull the driver roster once the session is proven good, then periodically.
    this.syncRoster();
    this.rosterTimer ??= setInterval(() => this.syncRoster(), config.rosterInterval);

    await this.readSse(recv.body);
  }

  async readSse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.stopped) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data) await this.handleData(data);
      }
    }
  }

  async handleData(data) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return; // non-JSON keep-alive frame
    }

    await api.heartbeat(this.session.id).catch(() => {});

    for (const message of payload.msg ?? []) {
      if (typeof message.seq === "number") this.seq = Math.max(this.seq, message.seq);
      if (message.type !== "push_fleet_unified_offer") continue;

      let inner;
      try {
        inner = typeof message.msg === "string" ? JSON.parse(message.msg) : message.msg;
      } catch {
        continue;
      }

      const offers = inner?.offers ?? [];
      if (offers.length === 0) continue;

      try {
        const result = await api.ingest(offers, message.seq);
        console.log(`[${this.tag()}] ingested ${offers.length} offer(s):`, result);
      } catch (e) {
        console.error(`[${this.tag()}] ingest failed: ${e.message}`);
      }
    }
  }

  async backoff() {
    const delay = this.reconnectDelay;
    console.log(`[${this.tag()}] reconnecting in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, config.reconnectMaxDelay);
  }
}
