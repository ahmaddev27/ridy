// Holds one fleet's RAMEN dispatch stream: handshake, read SSE, forward offers,
// and persist rolling cookies so an actively-used session outlives its idle TTL.

import { randomUUID } from "node:crypto";
// Import fetch from undici (not the global fetch): Node's global fetch ignores
// the per-request `dispatcher` option, so a per-stream ProxyAgent only takes
// effect when we call undici's own fetch.
import { ProxyAgent, fetch } from "undici";
import { config } from "./config.js";
import { api } from "./api.js";

// Filters the supplier getDrivers UI itself sends (all empty = "everyone").
const ROSTER_FILTERS = {
  documentFilter: [],
  activationFilter: [],
  tripsCountFilter: [],
  tripActivityFilter: [],
  rewardStatusFilter: [],
  onboardingStatusFilter: [],
  complianceStatusFitler: [],
  vehicleAssignmentStatusFilter: [],
  gigUnifiedStatusFilter: [],
  gigBaseTypeFilter: [],
  cityIdFilter: [],
  flowTypeFilter: [],
  driverRoleFilter: [],
  excludeAmdVirtualOperators: true,
  gigTypeOnboardingStatusFilter: [],
  gigTypeDocumentStatusFilter: [],
};

export class RamenStream {
  /**
   * @param session One fleet session { id, tenant_id, uber_org_uuid, cookies }.
   * @param ramenPath The RAMEN channel path, e.g. "/ramendca/events".
   * @param options.primary When true this stream also owns roster sync and
   *   cookie rotation; secondary channels only ingest offers (avoids duplicate
   *   roster pulls and racing cookie writes across a session's channels).
   */
  constructor(session, ramenPath = config.ramenPaths[0], { primary = true } = {}) {
    this.session = session; // { id, tenant_id, uber_org_uuid, cookies: [{name,value}] }
    this.ramenPath = ramenPath;
    this.primary = primary;
    this.jar = new Map(session.cookies.map((c) => [c.name, c.value]));
    this.seq = 0;
    this.stopped = false;
    this.reconnectDelay = config.reconnectMinDelay;
    // A stable device id per stream, mirroring the browser client's headers.
    this.deviceId = `vs_dispatch-${randomUUID()}`;

    // Route this company's Uber traffic through its own residential IP. Only
    // Uber requests use this dispatcher — calls back to our API stay direct.
    // Per-company proxy_url wins; else the daemon's global proxy; else direct.
    const proxyUrl = session.proxy_url || config.proxyUrl;
    this.proxyUrl = proxyUrl || ""; // remembered so the supervisor can detect changes
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    if (this.primary) {
      const safe = proxyUrl ? proxyUrl.replace(/\/\/[^@]*@/, "//***@") : "direct (no proxy)";
      console.log(`[${this.tag()}] exit: ${safe}`);
    }
  }

  stop() {
    this.stopped = true;
    this.controller?.abort();
    if (this.rosterTimer) clearInterval(this.rosterTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.dispatcher?.close?.();
  }

  /**
   * Pull the fleet's driver roster from supplier getDrivers and forward it.
   * getDrivers is a paginated POST (orgUuid + filters), returning driversData[]
   * with nested fields; routed through the same residential proxy as the stream.
   */
  async syncRoster() {
    try {
      const rows = [];
      let pageToken = "";
      for (let page = 1; page <= 100; page++) {
        const res = await fetch(`${config.uberSupplierBase}/api/getDrivers?localeCode=en-GB`, {
          method: "POST",
          headers: { ...this.headers(), "content-type": "application/json", "x-csrf-token": "x" },
          dispatcher: this.dispatcher,
          body: JSON.stringify({
            orgUuid: { uuid: { value: this.session.uber_org_uuid } },
            driversFilters: ROSTER_FILTERS,
            driverUuids: [],
            paginationOptions: {
              pageSize: { value: 100 },
              pageToken: pageToken ? { value: pageToken } : {},
            },
          }),
        });
        if (!res.ok) {
          console.warn(`[${this.tag()}] roster fetch -> ${res.status}`);
          return;
        }
        const result = await res.json();
        if (result.status !== "success") {
          console.warn(`[${this.tag()}] roster fetch: ${result.message || "not success"}`);
          return;
        }
        rows.push(...(result.data?.driversData ?? []));

        const next = result.data?.pageToken || "";
        if (!next || next === pageToken) break;
        pageToken = next;
      }

      if (rows.length === 0) return;

      const outcome = await api.roster(this.session.id, rows);
      console.log(`[${this.tag()}] roster synced: ${rows.length} drivers`, outcome);
    } catch (e) {
      console.error(`[${this.tag()}] roster sync failed: ${e.message}`);
    }
  }

  /**
   * Poll supplier GetDriverLiveLocation for the whole org and forward the driver
   * statuses. Fast + continuous so an ON_TRIP transition (offer acceptance) is
   * caught within seconds, regardless of whether a manager has a page open.
   * Uber returns coordinates as 0,0 (redacted), so we only forward the status.
   */
  async syncStatuses() {
    try {
      const res = await fetch(`${config.uberSupplierBase}/api/GetDriverLiveLocation?localeCode=en-GB`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json", "x-csrf-token": "x" },
        dispatcher: this.dispatcher,
        body: JSON.stringify({
          orgId: { uuid: { value: this.session.uber_org_uuid } },
          driverIds: [],
          filters: { allowedStatuses: [] },
          responseSelector: {
            includeStats: false,
            locationDetailsOptions: { fieldMask: { paths: ["location_updated_time", "driver_status"] } },
          },
        }),
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body.status !== "success") return;

      const statuses = (body.data?.driverLocations ?? [])
        .map((l) => ({
          driver_uuid: l.driverId?.value,
          status: l.driverStatus ?? null,
          location_updated_at: l.locationUpdatedTime?.value ? Number(l.locationUpdatedTime.value) : null,
        }))
        .filter((s) => s.driver_uuid);

      if (statuses.length === 0) return;
      const outcome = await api.statuses(this.session.id, statuses);
      if (outcome?.data?.accepted) {
        console.log(`[${this.tag()}] statuses: ${outcome.data.accepted} offer(s) marked accepted`);
      }
    } catch (e) {
      console.error(`[${this.tag()}] status sync failed: ${e.message}`);
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
    return `${config.uberDispatchBase}${this.ramenPath}${path}?seq=${seq}`;
  }

  /** Merge any Set-Cookie from a response into the jar, then persist to backend. */
  async absorbCookies(response) {
    // Only the primary channel persists rotated cookies, so a session's
    // channels don't race each other writing back to the backend.
    if (!this.primary) return;

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
    const channel = this.ramenPath.split("/").filter(Boolean)[0] ?? "ramen";
    return `session ${this.session.id}/${this.session.uber_org_uuid.slice(0, 8)} ${channel}`;
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
        // The blocked-IP case already warned once; don't spam it every retry.
        if (e.message !== "ramen_blocked_404") {
          console.error(`[${this.tag()}] stream error: ${e.message}`);
        }
      }
      if (this.stopped) break;
      await this.backoff();
    }
  }

  async connectOnce() {
    this.controller = new AbortController();

    // 1. Handshake. Uber's client sends seq=0 here (seq=-1 returns 404).
    const ack = await fetch(this.url("/ack", 0), { headers: this.headers(), signal: this.controller.signal, dispatcher: this.dispatcher });
    if (await this.handleAuthFailure(ack.status)) return;
    // Uber returns 404 on RAMEN for non-residential (datacenter) IPs. Without a
    // residential proxy the server can't hold the stream — offers are captured
    // via the browser extension instead. Warn once, then retry slowly so the
    // daemon recovers automatically if a proxy is later configured.
    if (ack.status === 404) {
      if (!this.blockedWarned) {
        this.blockedWarned = true;
        console.warn(
          `[${this.tag()}] RAMEN 404 — server IP looks blocked by Uber; ` +
            `offers rely on the browser extension. Set a residential proxy to stream server-side.`,
        );
      }
      this.reconnectDelay = config.reconnectMaxDelay;
      throw new Error("ramen_blocked_404");
    }
    if (!ack.ok) throw new Error(`ack -> ${ack.status}`);
    await this.absorbCookies(ack);

    // 2. Open the stream, resuming from the last seq we saw.
    const recv = await fetch(this.url("/recv", this.seq), { headers: this.headers(), signal: this.controller.signal, dispatcher: this.dispatcher });
    if (await this.handleAuthFailure(recv.status)) return;
    if (!recv.ok) throw new Error(`recv -> ${recv.status}`);
    await this.absorbCookies(recv);

    console.log(`[${this.tag()}] stream open (seq ${this.seq})`);
    this.reconnectDelay = config.reconnectMinDelay; // reset backoff on success

    // Pull the driver roster once the session is proven good, then periodically.
    // Only the primary channel does this — secondary channels just ingest offers.
    if (this.primary) {
      this.syncRoster();
      this.rosterTimer ??= setInterval(() => this.syncRoster(), config.rosterInterval);
      this.syncStatuses();
      this.statusTimer ??= setInterval(() => this.syncStatuses(), config.statusInterval);
    }

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
