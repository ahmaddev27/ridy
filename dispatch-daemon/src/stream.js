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
// NOTE: `complianceStatusFitler` is misspelled in Uber's OWN API contract — it
// must match their field name verbatim, so do NOT "correct" it.
// TODO(shared-contract): this object is duplicated in extension/background.js
// (ROSTER_FILTERS). The extension ships unbundled (raw MV3 files, no build step)
// and deploys separately from this Node daemon, so there is no shared module to
// import today. If a bundler is added to the extension, extract this (and the
// getDrivers request shape) into one shared source consumed by both.
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
    // supplier.uber.com needs its own host-scoped cookies for roster/status. Fall
    // back to the RAMEN jar for sessions captured before supplier cookies existed.
    this.supplierJar = new Map(
      (session.supplier_cookies?.length ? session.supplier_cookies : session.cookies).map((c) => [c.name, c.value]),
    );
    // Jar fingerprint (counts, not values) so the supervisor can restart this
    // stream when a re-link changes the captured cookies — e.g. supplier cookies
    // get backfilled after the manager reconnects while logged into
    // supplier.uber.com. Routine value rotation keeps the counts, so this won't
    // churn the stream on every refresh.
    this.cookieFp = `${session.cookies?.length ?? 0}:${session.supplier_cookies?.length ?? 0}`;
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
        const res = await fetch(`${config.uberSupplierBase}/api/getDrivers?localeCode=de-DE`, {
          method: "POST",
          headers: { ...this.supplierHeaders(), "content-type": "application/json", "x-csrf-token": "x" },
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
          // A supplier 401/403 means the cookies were rejected — the exact
          // "company changed their Uber password" case. Report it so the session
          // is flagged needs_relink and the manager is alerted.
          if (await this.handleAuthFailure(res.status)) return;
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
      const res = await fetch(`${config.uberSupplierBase}/api/GetDriverLiveLocation?localeCode=de-DE`, {
        method: "POST",
        headers: { ...this.supplierHeaders(), "content-type": "application/json", "x-csrf-token": "x" },
        dispatcher: this.dispatcher,
        body: JSON.stringify({
          orgId: { uuid: { value: this.session.uber_org_uuid } },
          driverIds: [],
          filters: { allowedStatuses: [] },
          // No fieldMask → Uber returns coordinates + course + trip waypoints for
          // the live map (idle/offline drivers come back as 0,0).
          responseSelector: { includeStats: true },
        }),
      });
      // A supplier 401/403 here is the clearest "session broken" signal (the
      // status poll runs continuously), so flag needs_relink and alert the manager.
      if (!res.ok) {
        await this.handleAuthFailure(res.status);
        return;
      }
      const body = await res.json();
      if (body.status !== "success") return;

      const statuses = (body.data?.driverLocations ?? [])
        .map((l) => ({
          driver_uuid: l.driverId?.value,
          status: l.driverStatus ?? null,
          location_updated_at: l.locationUpdatedTime?.value ? Number(l.locationUpdatedTime.value) : null,
          latitude: typeof l.latitude === "number" ? l.latitude : null,
          longitude: typeof l.longitude === "number" ? l.longitude : null,
          heading: typeof l.course === "number" ? l.course : null,
          waypoints: Array.isArray(l.waypointsLocation)
            ? l.waypointsLocation.map((w) => ({ lat: w.latitude, lng: w.longitude, type: w.checkpointType }))
            : null,
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
      // Force German so offer addresses come back consistently in German
      // (Uber otherwise localises them to the driver/rider language — Russian,
      // Arabic, English mixed).
      "accept-language": "de-DE,de;q=0.9",
      "x-uber-locale": "de-DE",
      "cache-control": "no-cache",
      "x-uber-client-name": "vs_dispatch",
      "x-uber-client-session": randomUUID(),
      "x-uber-client-version": "1.0.0",
      "x-uber-device": "web",
      "x-uber-device-id": this.deviceId,
      cookie: [...this.jar].map(([n, v]) => `${n}=${v}`).join("; "),
    };
  }

  /** Headers for supplier.uber.com calls — same shape but with the supplier jar. */
  supplierHeaders() {
    return { ...this.headers(), cookie: [...this.supplierJar].map(([n, v]) => `${n}=${v}`).join("; ") };
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
    this.lastHeartbeatAt = 0; // force an immediate heartbeat on the first frame

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

      // Any frame (offer OR keep-alive) means the stream is alive — heartbeat so
      // an open-but-quiet stream doesn't drift to "stale/idle" in System Health.
      // Throttled so frequent keep-alives don't spam the backend.
      await this.maybeHeartbeat();

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

  /** Heartbeat on stream activity, at most once per interval, so a live-but-quiet
   *  stream keeps its "last seen" fresh without spamming the backend. */
  async maybeHeartbeat() {
    const now = Date.now();
    if (this.lastHeartbeatAt && now - this.lastHeartbeatAt < 45000) return;
    this.lastHeartbeatAt = now;
    await api.heartbeat(this.session.id).catch(() => {});
  }

  async handleData(data) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return; // non-JSON keep-alive frame
    }

    await this.maybeHeartbeat();

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
