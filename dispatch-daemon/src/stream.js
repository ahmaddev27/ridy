// Holds one fleet's RAMEN dispatch stream: handshake, read SSE, forward offers,
// and persist rolling cookies so an actively-used session outlives its idle TTL.

import { createHash, randomUUID } from "node:crypto";
// Import fetch from undici (not the global fetch): Node's global fetch ignores
// the per-request `dispatcher` option, so a per-stream ProxyAgent only takes
// effect when we call undici's own fetch.
import { ProxyAgent, fetch } from "undici";
import { config } from "./config.js";
import { api, isStaleJar } from "./api.js";
import { captureThrottled } from "./sentry.js";
import {
  describeProxy,
  jitter,
  nextThrottleDelay,
  parseRetryAfter,
  parseSetCookie,
  statusSignature,
  toCookieList,
} from "./util.js";

/**
 * A fingerprint of a cookie jar's VALUES (not just its count), so the supervisor
 * restarts a stream when the manager reconnects and the token ROTATES to a new value
 * with the SAME cookie count — the count-only fingerprint missed that and left the
 * stream stuck on the dead cookies (RAMEN 404) until a manual daemon restart.
 * Stable between reconnects (stored cookies don't change), so it doesn't churn.
 */
export function jarFingerprint(cookies) {
  const list = toCookieList(cookies);
  if (list.length === 0) return "0";
  const joined = list
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join("|");
  return createHash("sha1").update(joined).digest("hex").slice(0, 16);
}

/**
 * Backend writes that must not be cut off by a restart (offer ingests, rotated
 * cookie persists). The SIGTERM handler waits for these, briefly, before exiting.
 */
export const inflight = new Set();
function track(promise) {
  inflight.add(promise);
  promise.then(
    () => inflight.delete(promise),
    () => inflight.delete(promise),
  );
  return promise;
}

// Offer-ingest retry policy. A failed ingest (backend/Caddy restarting during a
// deploy, a 5xx, a timeout) used to drop the offer for good — seq had already moved
// past it, so a reconnect never replays it. Retrying is safe: the backend ingest is
// idempotent on offer_uuid (unique (tenant_id, offer_uuid)).
//
// But an offer is only worth delivering while the driver can still accept it: the
// backend pushes every ingested offer, so a retry that lands after Uber's accept
// window rings the driver for a dead ride. A job is therefore retried only until
// its offers expire (offerGeneratedAtMs + acceptWindowInSeconds + grace), bounded
// to [INGEST_FRESH_MIN_MS, INGEST_FRESH_MAX_MS] after receipt so a skewed Uber
// clock can neither drop a live offer nor keep a dead one alive. A driver's
// newer offer supersedes an older one still waiting to (re)try.
const INGEST_MAX_CONCURRENCY = 4; // per stream, across different drivers
const INGEST_BACKLOG_MAX = 500; // queued batches per stream before the oldest is dropped
const INGEST_ACCEPT_WINDOW_DEFAULT_S = 15;
const INGEST_EXPIRY_GRACE_MS = 5000;
const INGEST_FRESH_MIN_MS = 10000;
const INGEST_FRESH_MAX_MS = 25000;
const INGEST_RETRY_MIN_MS = 500;
const INGEST_RETRY_MAX_MS = 4000;

/** Epoch ms after which a job's offers can no longer be accepted (see policy above). */
export function ingestExpiresAt(offers, receivedAt) {
  let expiry = 0;
  for (const offer of offers) {
    const generated = Number(offer?.offerGeneratedAtMs);
    const windowS = Number(offer?.acceptWindowInSeconds);
    if (!Number.isFinite(generated) || generated <= 0) continue;
    const seconds = Number.isFinite(windowS) && windowS > 0 ? windowS : INGEST_ACCEPT_WINDOW_DEFAULT_S;
    expiry = Math.max(expiry, generated + seconds * 1000 + INGEST_EXPIRY_GRACE_MS);
  }
  if (expiry === 0) expiry = receivedAt + INGEST_FRESH_MAX_MS;
  return Math.min(Math.max(expiry, receivedAt + INGEST_FRESH_MIN_MS), receivedAt + INGEST_FRESH_MAX_MS);
}

/** Network errors, timeouts, 408, 429 and 5xx may succeed on a retry; other 4xx never will. */
function isRetryableIngestError(error) {
  const status = error?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

// The backend treats the daemon as a company's live-status source only while its
// status POSTs keep arriving (DriverStatusIngestor::DAEMON_SOURCE_TTL_SECONDS = 20 s);
// after that the manager's extension writes statuses too. Delta forwarding may send
// nothing for a long time on an idle fleet, so POST at least this often. Must stay
// well inside that TTL (one missed poll still leaves headroom).
const STATUS_KEEPALIVE_MS = 8000;

// A never-terminated SSE line would otherwise grow the buffer without bound.
const SSE_BUFFER_MAX = 1_000_000;

// Drop-storm detection (see dropStorm()).
const STORM_MIN_LIFETIME_MS = 1500;
const STORM_THRESHOLD = 6;

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

/** Release a response body we won't read, so its connection is freed right away. */
function discardBody(response) {
  try {
    response?.body?.cancel?.()?.catch?.(() => {});
  } catch {
    /* already consumed/cancelled */
  }
}

export class RamenStream {
  /**
   * @param session One fleet session { id, tenant_id, uber_org_uuid, cookies }.
   * @param ramenPath The RAMEN channel path, e.g. "/ramendca/events".
   * @param options.primary When true this stream also owns roster sync and
   *   cookie rotation; secondary channels only ingest offers (avoids duplicate
   *   roster pulls and racing cookie writes across a session's channels).
   * @param options.onStaleJar Called when the backend says a reconnect replaced
   *   this stream's cookie jar (409 stale_jar), so the supervisor can restart on
   *   the fresh jar without waiting for its next poll.
   */
  constructor(session, ramenPath = config.ramenPaths[0], { primary = true, onStaleJar = null } = {}) {
    this.session = session; // { id, tenant_id, uber_org_uuid, cookies: [{name,value}] }
    this.ramenPath = ramenPath;
    this.primary = primary;
    // Defensive: the supervisor already normalizes rows, but a jar that arrives as
    // an object must never throw here and take the whole reconcile pass down.
    const cookies = toCookieList(session.cookies);
    const supplierCookies = toCookieList(session.supplier_cookies);
    this.jar = new Map(cookies.map((c) => [c.name, c.value]));
    // supplier.uber.com needs its own host-scoped cookies for roster/status. Fall
    // back to the RAMEN jar for sessions captured before supplier cookies existed.
    this.supplierJar = new Map((supplierCookies.length ? supplierCookies : cookies).map((c) => [c.name, c.value]));
    // Jar fingerprint over cookie VALUES so the supervisor restarts this stream
    // whenever the manager reconnects — even when the new token has the same cookie
    // COUNT (the old count-only fingerprint missed a value rotation and stuck the
    // stream on dead cookies with a RAMEN 404 until a manual restart).
    this.cookieFp = `${jarFingerprint(session.cookies)}:${jarFingerprint(session.supplier_cookies)}`;
    // The backend's jar generation this stream was built from. Echoed on cookie /
    // relink / degraded reports so a stream a reconnect replaced can't clobber the
    // fresh capture. Adopting our own rotation never changes it (the backend only
    // bumps it on a browser capture). Null from a backend that predates it.
    this.jarVersion = Number.isInteger(session.jar_version) ? session.jar_version : null;
    this.jarStale = false;
    this.onStaleJar = onStaleJar;
    this.seq = 0;
    this.stopped = false;
    this.reconnectDelay = config.reconnectMinDelay;
    this.rapidDrops = 0;
    // A stable device id per stream, mirroring the browser client's headers.
    this.deviceId = `vs_dispatch-${randomUUID()}`;

    // Offer-ingest pipeline state (see enqueueIngest).
    this.ingestChains = new Map(); // driver key -> tail promise (keeps one driver's offers ordered)
    this.ingestBacklog = []; // jobs not yet delivered, oldest first
    this.ingestActive = 0;
    this.ingestWaiters = [];
    this.ingestDropped = 0;
    this.ingestLatest = new Map(); // driver key -> newest job (a newer offer supersedes older waiting work)

    // Status-poll delta state (see syncStatuses).
    this.lastSentStatus = new Map(); // driver_uuid -> statusSignature of the last row the backend accepted
    this.lastFullStatusAt = 0;
    this.lastStatusPostAt = 0;
    this.supplierBackoffMs = 0;

    // Route this company's Uber traffic through its own residential IP. Only
    // Uber requests use this dispatcher — calls back to our API stay direct.
    // Per-company proxy_url wins; else the daemon's global proxy; else direct.
    const proxyUrl = session.proxy_url || config.proxyUrl;
    this.proxyUrl = proxyUrl || ""; // remembered so the supervisor can detect changes
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    if (this.primary) {
      console.log(`[${this.tag()}] exit: ${describeProxy(proxyUrl)}`);
    }
  }

  stop() {
    // Idempotent: a stream commonly gets stopped twice — handleStreamAuthFailure
    // stops it, then reconcile() sees it "no longer active" 60s later and stops it
    // again. The second dispatcher.close() on an already-destroyed ProxyAgent
    // rejected with ClientDestroyedError (an unhandledRejection in Sentry), so
    // return early once stopped.
    if (this.stopped) return;
    this.stopped = true;
    this.controller?.abort();
    if (this.rosterKickoff) clearTimeout(this.rosterKickoff);
    if (this.rosterTimer) clearInterval(this.rosterTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer); // adaptive loop uses setTimeout
    this.statusPolling = false;
    // Queued offer ingests are NOT cancelled: they go to our own backend (not
    // through the dispatcher) and must still land after a cookie/proxy restart.
    // close() returns a promise that rejects if the agent is already destroyed;
    // swallow it so a teardown race never becomes an unhandledRejection.
    try {
      this.dispatcher?.close?.()?.catch?.(() => {});
    } catch {
      /* a synchronous throw from an already-closed agent — nothing to do */
    }
  }

  /**
   * Pull the fleet's driver roster from supplier getDrivers and forward it.
   * getDrivers is a paginated POST (orgUuid + filters), returning driversData[]
   * with nested fields; routed through the same residential proxy as the stream.
   */
  async syncRoster() {
    if (this.stopped) return;
    try {
      const rows = [];
      let pageToken = "";
      for (let page = 1; page <= 100; page++) {
        const res = await fetch(`${config.uberSupplierBase}/api/getDrivers?localeCode=de-DE`, {
          method: "POST",
          headers: { ...this.supplierHeaders(), "content-type": "application/json", "x-csrf-token": "x" },
          dispatcher: this.dispatcher,
          // A hung proxy connection would otherwise park this page forever.
          signal: AbortSignal.timeout(config.rosterTimeout),
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
        if (this.stopped) {
          discardBody(res);
          return; // torn down mid-pull: never post a roster for a dead stream
        }
        if (!res.ok) {
          discardBody(res);
          // A supplier 401/403 degrades roster/status but NOT the offer stream —
          // handle it without tearing the stream down.
          if (await this.handleSupplierAuthFailure(res.status)) return;
          this.noteSupplierThrottle(res);
          console.warn(`[${this.tag()}] roster fetch -> ${res.status}`);
          return;
        }
        this.supplierRecovered();
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

      if (rows.length === 0 || this.stopped) return;

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
   *
   * Forwards the status plus the live coordinates, course and trip waypoints Uber
   * returns for engaged drivers (idle/offline drivers come back as 0,0, which the
   * backend discards). Only rows that changed since the last accepted send are
   * posted, plus a full batch every statusFullSyncInterval (see config).
   *
   * @returns {Promise<boolean>} whether any driver is engaged (drives the cadence)
   */
  async syncStatuses() {
    let res;
    try {
      res = await fetch(`${config.uberSupplierBase}/api/GetDriverLiveLocation?localeCode=de-DE`, {
        method: "POST",
        headers: { ...this.supplierHeaders(), "content-type": "application/json", "x-csrf-token": "x" },
        dispatcher: this.dispatcher,
        // Without a deadline a stalled poll freezes the whole adaptive chain
        // (scheduleStatusPoll only reschedules after this await resolves), so
        // driver statuses stop and every offer reads "Not taken".
        signal: AbortSignal.timeout(config.statusTimeout),
        body: JSON.stringify({
          orgId: { uuid: { value: this.session.uber_org_uuid } },
          driverIds: [],
          filters: { allowedStatuses: [] },
          // No fieldMask → Uber returns coordinates + course + trip waypoints for
          // the live map (idle/offline drivers come back as 0,0).
          responseSelector: { includeStats: true },
        }),
      });
    } catch (e) {
      if (this.stopped) return false;
      console.error(`[${this.tag()}] status poll failed: ${e.message}`);
      this.noteSupplierThrottle(null);
      return false;
    }
    if (this.stopped) {
      discardBody(res);
      return false;
    }

    // A supplier 401/403 here degrades live status but NOT the offer stream —
    // keep streaming offers; just slow the poll and (once persistent) prompt a
    // reconnect. supplierAuthFails throttles the poll cadence in scheduleStatusPoll.
    if (!res.ok) {
      discardBody(res);
      if (!(await this.handleSupplierAuthFailure(res.status))) this.noteSupplierThrottle(res);
      return false;
    }
    this.supplierRecovered();

    let statuses;
    try {
      const body = await res.json();
      if (body.status !== "success") return false;
      statuses = this.mapStatuses(body.data?.driverLocations);
    } catch (e) {
      console.error(`[${this.tag()}] status poll parse failed: ${e.message}`);
      return false;
    }
    if (statuses.length === 0) return false;

    // Any engaged driver (just accepted / on a trip) → the caller polls faster so
    // this trip's live-map waypoints are captured within seconds of acceptance.
    const engaged = statuses.some((s) => {
      const u = String(s.status || "").toUpperCase();
      return u.includes("EN_ROUTE") || u.includes("ON_TRIP");
    });

    await this.forwardStatuses(statuses);
    return engaged;
  }

  mapStatuses(driverLocations) {
    return (Array.isArray(driverLocations) ? driverLocations : [])
      .filter((l) => l && typeof l === "object")
      .map((l) => ({
        driver_uuid: l.driverId?.value,
        status: l.driverStatus ?? null,
        location_updated_at: l.locationUpdatedTime?.value ? Number(l.locationUpdatedTime.value) : null,
        latitude: typeof l.latitude === "number" ? l.latitude : null,
        longitude: typeof l.longitude === "number" ? l.longitude : null,
        heading: typeof l.course === "number" ? l.course : null,
        waypoints: Array.isArray(l.waypointsLocation)
          ? l.waypointsLocation.map((w) => ({ lat: w?.latitude, lng: w?.longitude, type: w?.checkpointType }))
          : null,
      }))
      .filter((s) => s.driver_uuid);
  }

  /**
   * POST only what changed since the backend last accepted a row for that driver
   * (every poll used to UPDATE every driver row + write a full-payload network log),
   * with a periodic full batch as the freshness/sweep backstop. The "last sent"
   * memory only advances on success, so a failed POST is re-sent next poll.
   * With nothing changed, one unchanged row is still sent every STATUS_KEEPALIVE_MS
   * so the backend keeps the daemon as the status source (see that constant).
   */
  async forwardStatuses(statuses) {
    const now = Date.now();
    const full = !config.statusFullSyncInterval || now - this.lastFullStatusAt >= config.statusFullSyncInterval;
    let batch = full ? statuses : statuses.filter((s) => this.lastSentStatus.get(s.driver_uuid) !== statusSignature(s));
    if (batch.length === 0 && statuses.length > 0 && now - this.lastStatusPostAt >= STATUS_KEEPALIVE_MS) {
      batch = statuses.slice(0, 1);
    }
    if (batch.length === 0) return;

    try {
      const outcome = await api.statuses(this.session.id, batch);
      this.lastStatusPostAt = now;
      for (const s of batch) this.lastSentStatus.set(s.driver_uuid, statusSignature(s));
      if (full) this.lastFullStatusAt = now;
      if (outcome?.data?.accepted) {
        console.log(`[${this.tag()}] statuses: ${outcome.data.accepted} offer(s) marked accepted`);
      }
    } catch (e) {
      console.error(`[${this.tag()}] status forward failed: ${e.message}`);
    }
  }

  /**
   * Poll driver statuses on an ADAPTIVE cadence: fast while any driver is engaged
   * (so a just-accepted offer's real pickup/drop-off waypoints are captured within
   * seconds), and slower when everyone is idle to keep supplier load low.
   * Self-reschedules; the handle lives in statusTimer so stop() cancels it.
   */
  scheduleStatusPoll(delay) {
    if (this.stopped) return;
    this.statusTimer = setTimeout(async () => {
      let engaged = false;
      try {
        engaged = await this.syncStatuses();
      } catch {
        /* syncStatuses logs its own errors */
      }
      this.scheduleStatusPoll(this.nextStatusDelay(engaged));
    }, delay);
  }

  nextStatusDelay(engaged) {
    // While Fleet Hub is rejecting us, poll slowly (supplierRetryInterval) instead
    // of hammering it every 3-6s — fewer failing calls, less chance of a wider block.
    // A 429/5xx/timeout backs off on its own schedule (honouring Retry-After).
    const base = this.supplierAuthFails
      ? config.supplierRetryInterval
      : this.supplierBackoffMs
        ? this.supplierBackoffMs
        : engaged
          ? config.statusIntervalActive
          : config.statusInterval;
    // ±10% so companies' poll chains drift apart instead of hitting Uber and the
    // backend in phase-aligned bursts.
    return Math.round(base * (0.9 + Math.random() * 0.2));
  }

  /**
   * Fleet Hub answered 429 / 5xx (or the poll timed out): back the status poll off
   * exponentially, honouring Retry-After. Deliberately separate from the 401/403
   * auth path — throttling is NOT a reason to prompt the manager to reconnect.
   */
  noteSupplierThrottle(res) {
    if (res && res.status !== 429 && res.status < 500) return;
    const retryAfter = res ? parseRetryAfter(res.headers?.get?.("retry-after")) : 0;
    this.supplierBackoffMs = nextThrottleDelay(
      this.supplierBackoffMs,
      retryAfter,
      config.statusInterval,
      config.supplierRetryInterval,
    );
    console.warn(
      `[${this.tag()}] Fleet Hub ${res ? `-> ${res.status}` : "unreachable"}; next status poll in ~${this.supplierBackoffMs}ms`,
    );
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

  /**
   * Merge any Set-Cookie from a response into the jar and (primary only) persist
   * the rotated jar in the BACKGROUND. The persist used to be awaited between /ack
   * and /recv — a backend round-trip (up to apiTimeout) inside the blind window the
   * 250ms fast reopen exists to minimise.
   */
  absorbCookies(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length === 0) return;

    // Merge Uber's rotated cookies into THIS channel's jar (both channels, so a
    // secondary's jar never goes stale against a rotated session token). A deletion
    // (Max-Age<=0 / past Expires / empty value) removes the cookie: persisting it as
    // an empty value was rejected by the backend (422) and blocked every later write.
    for (const raw of setCookies) {
      const cookie = parseSetCookie(raw);
      if (!cookie) continue;
      if (cookie.deleted) this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }

    // Only the PRIMARY channel persists the rotated jar AND advances its own
    // fingerprint. Advancing it keeps reconcile() from mistaking the daemon's own
    // rolling refresh for an external re-link and tearing the primary down (seq
    // reset -> dropped offers). The SECONDARY keeps its constructor fingerprint and
    // never persists (so channels don't race the backend write); reconcile() adopts
    // the primary's rotation into the secondary without a teardown — see its
    // self-rotation branch — so a rotation never resets the secondary's seq either.
    if (!this.primary || this.stopped) return;
    this.persistJar().catch(() => {});
  }

  /** The fingerprint the backend would hold if it stored the current jar. */
  liveJarFingerprint() {
    const cookies = [...this.jar].map(([name, value]) => ({ name, value }));
    return { cookies, fp: `${jarFingerprint(cookies)}:${jarFingerprint(this.session.supplier_cookies)}` };
  }

  /**
   * Single-flight persist of the live jar. A rotation that arrives while a write is
   * in flight marks the jar dirty and is written (latest jar only) once that write
   * settles. An unchanged jar is never written (every Set-Cookie used to cost a DB
   * update + a network-log row).
   *
   * cookieFp advances ONLY after the backend has stored that exact jar. If the write
   * fails (backend restarting mid-deploy, or a timeout) an already-advanced
   * fingerprint would be ahead of what the backend serves, so the next reconcile()
   * would see a mismatch it can't attribute to a self-rotation and tear the stream
   * down — restarting it on the OLD cookies with seq reset to 0. Keeping the old
   * fingerprint on failure means the next rotation simply retries the write.
   */
  async persistJar() {
    if (this.persisting) {
      this.persistDirty = true;
      return;
    }
    this.persisting = true;
    try {
      do {
        this.persistDirty = false;
        // A torn-down stream (or one a reconnect superseded) must not overwrite a
        // newer re-link with its old jar.
        if (this.stopped || this.jarStale) return;
        const { cookies, fp } = this.liveJarFingerprint();
        if (fp === this.cookieFp || cookies.length === 0) continue;
        try {
          await track(api.refreshCookies(this.session.id, cookies, undefined, this.jarVersion));
          this.cookieFp = fp;
        } catch (e) {
          // Our jar was replaced by a reconnect: never retry the write or advance
          // the fingerprint. Keep streaming (the old cookies may still deliver
          // offers) until the supervisor restarts us on the fresh jar.
          if (isStaleJar(e)) {
            this.markJarStale("cookie refresh");
            return;
          }
          console.error(`[${this.tag()}] cookie refresh failed: ${e.message}`);
          captureThrottled(`cookies:${this.session.id}`, e, { where: "cookie_refresh", sessionId: this.session.id });
        }
      } while (this.persistDirty);
    } finally {
      this.persisting = false;
    }
  }

  /** The backend holds a newer cookie jar for this session: stop writing, ask for a restart. */
  markJarStale(where) {
    if (!this.jarStale) {
      console.warn(`[${this.tag()}] ${where} refused: a reconnect replaced jar v${this.jarVersion} — restarting on the fresh jar`);
    }
    this.jarStale = true;
    try {
      this.onStaleJar?.();
    } catch {
      /* the supervisor's next poll restarts us anyway */
    }
  }

  tag() {
    const channel = this.ramenPath.split("/").filter(Boolean)[0] ?? "ramen";
    return `session ${this.session.id}/${String(this.session.uber_org_uuid).slice(0, 8)} ${channel}`;
  }

  /**
   * The RAMEN OFFER stream itself (ack/recv) was rejected — the offer cookies are
   * dead, so the session truly needs relinking: flag it and stop. Returns true when
   * it handled a rejection.
   */
  async handleStreamAuthFailure(status) {
    if (status === 401 || status === 403) {
      console.warn(`[${this.tag()}] stream auth rejected (${status}) -> needs relink`);
      // A 401 on a jar a reconnect already replaced says nothing about the fresh
      // one: the backend refuses it (stale_jar) and we just make way for it.
      await api.needsRelink(this.session.id, this.jarVersion).catch((e) => {
        if (isStaleJar(e)) this.markJarStale("needs-relink");
      });
      this.stop();
      return true;
    }
    return false;
  }

  /**
   * A FLEET HUB call (roster / live-status) was rejected. Its cookies are separate
   * from the RAMEN stream's, and the offer stream is still delivering — so DO NOT
   * stop it (that was the ~4.5h offer outage on 2026-09-12/13). Count consecutive
   * failures; once they persist, prompt the manager to reconnect WITHOUT flagging
   * the session broken, at most once per cooldown. Returns true on a rejection.
   */
  async handleSupplierAuthFailure(status) {
    if (status !== 401 && status !== 403) return false;

    this.supplierAuthFails = (this.supplierAuthFails ?? 0) + 1;
    console.warn(`[${this.tag()}] Fleet Hub auth rejected (${status}) x${this.supplierAuthFails} — offer stream kept alive`);

    const now = Date.now();
    const persistent = this.supplierAuthFails >= config.supplierFailThreshold;
    const cooledDown = !this.supplierDegradedAt || now - this.supplierDegradedAt > config.supplierDegradedCooldown;
    if (persistent && cooledDown) {
      this.supplierDegradedAt = now;
      await api.supplierDegraded(this.session.id, this.jarVersion).catch((e) => {
        if (isStaleJar(e)) this.markJarStale("supplier-degraded");
      });
    }
    return true;
  }

  /** A Fleet Hub call succeeded again — clear the degraded/throttled state. */
  supplierRecovered() {
    if (this.supplierAuthFails) {
      console.log(`[${this.tag()}] Fleet Hub recovered after ${this.supplierAuthFails} failure(s)`);
    }
    this.supplierAuthFails = 0;
    this.supplierDegradedAt = null;
    this.supplierBackoffMs = 0;
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
      await this.afterCycle();
    }
  }

  /**
   * Decide how long to wait before the next connect.
   *
   * A stream that ACTUALLY OPENED and then ended/dropped is the normal RAMEN
   * long-poll cycle (or a proxy connection reset) — NOT a failure. Reopen almost
   * immediately, resuming from this.seq, so the blind window between streams is
   * ~250ms instead of the 2s error-backoff (offers Uber dispatches in that gap
   * would otherwise be missed). Exponential backoff is reserved for a failure
   * BEFORE the stream opened (handshake/HTTP/404/connect) or a storm of instant
   * drops (a hard-down proxy) — so we never hammer Uber.
   *
   * The backoff is reset ONLY here, on the healthy path. It used to reset on every
   * successful open, so a storm of open-then-drop cycles never grew past 2s.
   */
  async afterCycle() {
    const storming = this.streamOpened ? this.dropStorm() : false;
    if (this.streamOpened && !storming) {
      this.reconnectDelay = config.reconnectMinDelay;
      await this.sleep(config.streamCycleDelay);
    } else {
      await this.backoff();
    }
  }

  /**
   * Fetch on this stream's controller with a deadline on the CONNECT phase only.
   * The timer aborts when no response arrives in time and is cleared the moment
   * one does, so /recv's body may then stream for as long as it stays alive (the
   * idle watchdog in readSse guards that phase; a deadline on the body itself
   * would kill a healthy long-poll). Without it, a proxy that accepts the
   * connection and never answers leaves run() awaiting forever: no error, no
   * reconnect, no offers.
   */
  async fetchOpening(url) {
    const timer = setTimeout(() => this.controller.abort(), config.handshakeTimeout);
    try {
      return await fetch(url, { headers: this.headers(), signal: this.controller.signal, dispatcher: this.dispatcher });
    } finally {
      clearTimeout(timer);
    }
  }

  async connectOnce() {
    this.controller = new AbortController();
    // Cleared until the stream truly opens; run() reads it to decide fast-reopen
    // (opened → benign cycle) vs exponential backoff (failed before opening).
    this.streamOpened = false;

    // 1. Handshake. Uber's client sends seq=0 here (seq=-1 returns 404).
    const ack = await this.fetchOpening(this.url("/ack", 0));
    // The ack body carries nothing we use; release it so the connection is freed.
    discardBody(ack);
    if (await this.handleStreamAuthFailure(ack.status)) return;
    // Uber returns 404 on RAMEN for non-residential (datacenter) IPs. Without a
    // residential proxy the server can't hold the stream — offers are captured
    // via the browser extension instead. Warn once, then retry slowly so the
    // daemon recovers automatically if a proxy is later configured.
    if (ack.status === 404) {
      if (!this.blockedWarned) {
        this.blockedWarned = true;
        console.warn(
          `[${this.tag()}] RAMEN 404 — Uber rejected this session's stream. Likely cause: ` +
            `the company's captured Uber cookies are STALE (reconnect the company to refresh them). ` +
            `If ALL companies 404 on the same proxy, the IP itself is blocked (needs a residential proxy). ` +
            `Meanwhile offers for this company fall back to the browser extension.`,
        );
      }
      // NOTE: we deliberately do NOT start the supplier roster/status polls here.
      // A RAMEN 404 means this IP can't hold the STREAM; if the company also has no
      // working residential proxy, the supplier polls would go out from the same
      // datacenter IP and could be rejected (403) — which our auth-failure handler
      // would misread as bad cookies and falsely flag the session needs_relink.
      // When RAMEN is blocked, offers/statuses come from the browser extension
      // (manager's real IP). The daemon streams + polls only once it has a working
      // residential proxy (then RAMEN connects and polling starts normally below).
      this.reconnectDelay = config.reconnectMaxDelay;
      throw new Error("ramen_blocked_404");
    }
    if (!ack.ok) throw new Error(`ack -> ${ack.status}`);
    this.absorbCookies(ack);
    if (this.stopped) return;

    // 2. Open the stream, resuming from the last seq we saw.
    const recv = await this.fetchOpening(this.url("/recv", this.seq));
    if (await this.handleStreamAuthFailure(recv.status)) {
      discardBody(recv);
      return;
    }
    if (!recv.ok) {
      discardBody(recv);
      throw new Error(`recv -> ${recv.status}`);
    }
    this.absorbCookies(recv);
    // Stopped while the handshake was in flight (a reconcile restart): don't open,
    // and above all don't start roster/status timers that stop() already ran past.
    if (this.stopped) {
      discardBody(recv);
      return;
    }

    console.log(`[${this.tag()}] stream open (seq ${this.seq})`);
    this.streamOpened = true; // from here a drop is a mid-stream cycle, not a failure
    this.openedAt = Date.now();
    // Heartbeat right away (fire-and-forget — never ahead of the first frame, which
    // is the one most likely to carry the backlog resumed from seq).
    this.lastHeartbeatAt = 0;
    this.maybeHeartbeat();

    // Only the primary channel pulls roster/status — secondary channels just ingest.
    if (this.primary) this.startSupplierPolls();

    await this.readSse(recv.body);
  }

  /**
   * Roster: ONCE on the first successful open, then every rosterInterval (30 min).
   * Do NOT re-pull on every reopen: the RAMEN long-poll cycle reopens every few
   * minutes, so calling syncRoster() each time hammered Fleet Hub ~20x/hour —
   * needless load that raises the odds of a 403. A genuine re-link builds a fresh
   * stream that pulls once again. The first pull and the first status poll are
   * jittered so a daemon restart doesn't fire every company's pulls in one second.
   */
  startSupplierPolls() {
    if (this.stopped) return;
    if (!this.rosterTimer) {
      this.rosterKickoff = setTimeout(() => this.syncRoster(), Math.floor(Math.random() * 30000));
      this.rosterTimer = setInterval(() => this.syncRoster(), config.rosterInterval);
    }
    // Adaptive status polling — start the self-rescheduling loop once (a reconnect
    // must not stack a second chain).
    if (!this.statusPolling) {
      this.statusPolling = true;
      this.scheduleStatusPoll(Math.floor(Math.random() * config.statusInterval));
    }
  }

  async readSse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Idle watchdog. Every recovery path in run() is triggered by this read ENDING
    // or throwing, so a connection that goes quiet WITHOUT closing (a proxy that drops
    // the path but leaves the socket open, a TCP black hole) would park here forever —
    // the daemon healthy-looking and silent, with an unbounded blind window. Aborting
    // surfaces as a normal stream error while streamOpened is true, so run() reopens
    // from this.seq on the fast 250 ms path: no seq reset, no lost offers.
    let lastFrameAt = Date.now();
    const watchdog = setInterval(() => {
      const idleMs = Date.now() - lastFrameAt;
      if (idleMs < config.streamIdleTimeout) return;
      console.warn(`[${this.tag()}] no frame for ${Math.round(idleMs / 1000)}s — reopening the stream`);
      this.controller.abort();
    }, Math.max(1000, Math.round(config.streamIdleTimeout / 3)));

    try {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        lastFrameAt = Date.now();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (buffer.length > SSE_BUFFER_MAX) {
          console.warn(`[${this.tag()}] unterminated SSE line over ${SSE_BUFFER_MAX} chars — reopening from seq ${this.seq}`);
          this.controller.abort();
          break;
        }

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          // One malformed frame is skipped; it must not tear down a healthy stream.
          try {
            this.handleData(data);
          } catch (e) {
            console.error(`[${this.tag()}] bad frame skipped: ${e.message}`);
          }
        }

        // Any frame (offer OR keep-alive) means the stream is alive — heartbeat so
        // an open-but-quiet stream doesn't drift to "stale/idle" in System Health.
        // Throttled, and never awaited: a backend round-trip must not delay reading.
        this.maybeHeartbeat();
      }
    } finally {
      clearInterval(watchdog);
      reader.cancel().catch(() => {});
    }
  }

  /** Heartbeat on stream activity, at most once per interval, so a live-but-quiet
   *  stream keeps its "last seen" fresh without spamming the backend. Never throws. */
  maybeHeartbeat() {
    const now = Date.now();
    if (this.lastHeartbeatAt && now - this.lastHeartbeatAt < 45000) return;
    this.lastHeartbeatAt = now;
    api.heartbeat(this.session.id).catch(() => {});
  }

  /**
   * Parse one SSE data frame: advance seq synchronously, hand offers to the ingest
   * pipeline without awaiting it (a backend round-trip — geocode + FCM, up to
   * seconds — must never hold up reading the next offer inside Uber's ~5s window).
   */
  handleData(data) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      if (data.startsWith("{")) console.warn(`[${this.tag()}] unparseable JSON frame dropped (${data.length} chars)`);
      return; // non-JSON keep-alive frame
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.msg)) return;

    for (const message of payload.msg) {
      if (!message || typeof message !== "object") continue;
      if (typeof message.seq === "number") this.seq = Math.max(this.seq, message.seq);
      if (message.type !== "push_fleet_unified_offer") continue;

      let inner;
      try {
        inner = typeof message.msg === "string" ? JSON.parse(message.msg) : message.msg;
      } catch {
        continue;
      }

      const offers = Array.isArray(inner?.offers) ? inner.offers.filter((o) => o && typeof o === "object") : [];
      if (offers.length === 0) continue;

      this.enqueueIngest(offers, message.seq);
    }
  }

  /**
   * Queue offers for ingestion. Offers are split per driver: one driver's offers
   * stay strictly ordered (the backend supersedes a driver's earlier pending offer
   * with a newer one), while different drivers are ingested concurrently (up to
   * INGEST_MAX_CONCURRENCY), so one slow geocode doesn't delay another driver's push.
   * A driver's newer offer supersedes an older job that is still waiting or in
   * retry backoff, so stale work never holds up the driver's live offer.
   */
  enqueueIngest(offers, seq) {
    const groups = new Map();
    for (const offer of offers) {
      const key = offer.driverInfo?.driverUUID || "_unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(offer);
    }

    for (const [key, group] of groups) {
      const now = Date.now();
      const job = { offers: group, seq, enqueuedAt: now, expiresAt: ingestExpiresAt(group, now), attempts: 0, dropped: false, inFlight: false, superseded: false, wake: null };
      this.ingestBacklog.push(job);
      if (this.ingestBacklog.length > INGEST_BACKLOG_MAX) this.dropJob(this.ingestBacklog.shift(), "backlog full");

      // An older job for this driver that already FAILED (sleeping in backoff or
      // waiting for a retry slot) is dropped so this one goes out right away. One
      // not yet sent or mid-request keeps its single first attempt (order and the
      // offer's row are preserved) but is never retried ahead of this one.
      // "_unknown" offers belong to no driver and never supersede each other.
      const older = key === "_unknown" ? null : this.ingestLatest.get(key);
      if (older && older.attempts > 0 && !older.inFlight) {
        this.dropJob(older, "superseded by a newer offer for the same driver", { quiet: true });
      } else if (older) {
        older.superseded = true;
      }
      this.ingestLatest.set(key, job);

      const previous = this.ingestChains.get(key) ?? Promise.resolve();
      const deliver = () => this.deliverIngest(job);
      // Run after the previous job whether it resolved or not — one failure must
      // never wedge the driver's chain.
      const tail = track(previous.then(deliver, deliver));
      this.ingestChains.set(key, tail);
      const forget = () => {
        if (this.ingestChains.get(key) === tail) this.ingestChains.delete(key);
        if (this.ingestLatest.get(key) === job) this.ingestLatest.delete(key);
      };
      tail.then(forget, forget);
    }
  }

  /**
   * Deliver one job, retrying transient failures with backoff while its offers
   * can still be accepted. Never sends it after job.expiresAt (logged + dropped).
   */
  async deliverIngest(job) {
    let delay = INGEST_RETRY_MIN_MS;
    try {
      while (!job.dropped) {
        await this.acquireIngestSlot();
        let error = null;
        try {
          // Re-checked after waiting for a slot: superseded or expired meanwhile.
          if (job.dropped) return;
          if (Date.now() >= job.expiresAt) {
            const age = Math.round((Date.now() - job.enqueuedAt) / 1000);
            this.dropJob(job, `accept window over (${age}s after receipt, ${job.attempts} attempt(s))`, { quiet: true });
            return;
          }
          job.attempts++;
          job.inFlight = true;
          const result = await api.ingest(job.offers, job.seq);
          console.log(`[${this.tag()}] ingested ${job.offers.length} offer(s)${job.attempts > 1 ? ` (attempt ${job.attempts})` : ""}:`, result);
          return;
        } catch (e) {
          error = e;
        } finally {
          job.inFlight = false;
          this.releaseIngestSlot();
        }

        console.error(`[${this.tag()}] ingest failed (attempt ${job.attempts}, seq ${job.seq}): ${error.message}`);
        if (!isRetryableIngestError(error)) {
          this.dropJob(job, `rejected: ${error.message}`);
          return;
        }
        if (job.superseded) {
          this.dropJob(job, `superseded by a newer offer for the same driver: ${error.message}`, { quiet: true });
          return;
        }
        const remaining = job.expiresAt - Date.now();
        if (remaining <= 0) {
          this.dropJob(job, `accept window over after ${job.attempts} attempt(s): ${error.message}`, { quiet: true });
          return;
        }
        await this.ingestBackoff(job, Math.min(jitter(delay), remaining));
        delay = Math.min(delay * 2, INGEST_RETRY_MAX_MS);
      }
    } finally {
      const index = this.ingestBacklog.indexOf(job);
      if (index !== -1) this.ingestBacklog.splice(index, 1);
    }
  }

  /** Retry backoff that dropJob() (a newer offer superseding this one) cuts short. */
  async ingestBackoff(job, ms) {
    if (job.dropped) return;
    await Promise.race([this.sleep(ms), new Promise((resolve) => (job.wake = resolve))]);
    job.wake = null;
  }

  /**
   * Give up on a job. `quiet` drops (accept window over / superseded) are the
   * expected outcome of a backend blip, so they are only logged; the rest also go
   * to Sentry (throttled).
   */
  dropJob(job, reason, { quiet = false } = {}) {
    if (!job || job.dropped) return;
    job.dropped = true;
    job.wake?.();
    this.ingestDropped++;
    const message = `dropped ${job.offers.length} offer(s) at seq ${job.seq}: ${reason} (total dropped ${this.ingestDropped})`;
    if (quiet) {
      console.warn(`[${this.tag()}] ${message}`);
      return;
    }
    console.error(`[${this.tag()}] ${message}`);
    captureThrottled(`ingest-drop:${this.session.id}`, new Error(`offer ingest ${message}`), {
      where: "ingest_drop",
      sessionId: this.session.id,
    }, 5 * 60 * 1000);
  }

  acquireIngestSlot() {
    if (this.ingestActive < INGEST_MAX_CONCURRENCY) {
      this.ingestActive++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.ingestWaiters.push(resolve));
  }

  releaseIngestSlot() {
    const next = this.ingestWaiters.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else this.ingestActive--;
  }

  async backoff() {
    // Jittered so every stream behind one failing proxy/backend doesn't retry in
    // lockstep. (The 250ms fast reopen above is deliberately NOT jittered.)
    const delay = jitter(this.reconnectDelay);
    console.log(`[${this.tag()}] reconnecting in ${delay}ms`);
    await this.sleep(delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, config.reconnectMaxDelay);
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * True when the stream keeps dying almost instantly — a hard-down proxy or a
   * rejected session, not a healthy long-poll cycle. Counts consecutive opens
   * that lived < STORM_MIN_LIFETIME_MS; once STORM_THRESHOLD in a row, run()
   * switches from fast-reopen to exponential backoff so we don't hammer Uber. A
   * stream that lived long enough resets the counter. Call once per cycle.
   */
  dropStorm() {
    const lifetime = Date.now() - (this.openedAt ?? 0);
    const wasStorming = this.rapidDrops >= STORM_THRESHOLD;
    this.rapidDrops = lifetime < STORM_MIN_LIFETIME_MS ? this.rapidDrops + 1 : 0;
    const storming = this.rapidDrops >= STORM_THRESHOLD;
    if (storming && !wasStorming) console.warn(`[${this.tag()}] drop storm — backing off exponentially`);
    if (!storming && wasStorming) console.log(`[${this.tag()}] drop storm over`);
    return storming;
  }
}
