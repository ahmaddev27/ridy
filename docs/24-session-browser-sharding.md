# 24 · Session-Browser (uber-auth) Sharding — 20 → ~1000 companies

**Status:** DESIGN ONLY. Nothing here is built. Builds on [`23`](./23-persistent-session-browser.md)
(the persistent browser, live fleet-wide since 30.10) and mirrors the proven daemon
sharding of [`18`](./18-daemon-sharding.md).

**Hard limits that do not move** (AGENTS.md / docs 23): the browser never stores an Uber
password and never automates OTP/Arkose; the only Uber write anywhere is the dispatch
decline (the browser makes none); Uber's ~monthly HARD re-auth still needs one human
relink; many tenants behind one proxy IP is fine; a datacenter IP for the browser is
accepted. Scope: reuse the daemon pattern, change nothing settled.

---

## 1. Why it does not scale today

| Fact | Where |
| --- | --- |
| ONE Chromium **process** per company: `seedFromSession` calls `launchBrowser()` then a context | `uber-auth/src/persistent.js:140-141`; same in `resumeFromDisk` `:120` |
| Hard cap 20 live entries per service, RAM guard | `uber-auth/src/config.js:44` (`MAX_SESSIONS`), `sessionManager.js:109-110`, `adopt` throws `at_capacity` `:136` |
| ONE service instance reconciles against **every** company: `wanted` returns, and decrypts, every usable jar every 60 s | `SessionBrowserController.php:99-119`, poll `persistent.js:178`, `config.js:53` |
| `rescue` is also fleet-wide, polled every 3 s | `SessionBrowserController.php:127-134`, `config.js:41` |
| `status` push resolves the tenant per row and upserts per row (2 queries/row) | `SessionBrowserController.php:45-52, 196-219` |
| No ownership notion: whoever polls owns everything | no `shard_id` equivalent for browsers |
| `resumeFromDisk` resumes **every** `/state/*.json`, with no check that the company is still this box's | `persistent.js:104-130` |
| Close = kill the whole Chromium (`handle.browser.close()`) | `warmDriver.js:139-141` |
| One compose service, one `uber_auth_state` volume | `docker-compose.prod.yml:353-379, 419` |

Memory today: ~150-350 MB per company (one process each) => 20 companies is already
3-7 GB; 1000 would be 150-350 GB. The cap, not CPU, is the wall.

The daemon solved the same problem with: a `daemon_shards` registry (name + heartbeat),
`uber_fleet_sessions.shard_id`, a poll endpoint that returns only the caller's slice, and
self-healing reassignment. We copy that shape (section 2-3) and add the one thing the
daemon does not need: shared Chromium processes inside a box (section 4).

---

## 2. Decision A — shard identity: SEPARATE `browser_shard_id` (recommended)

**Option 1 — reuse `uber_fleet_sessions.shard_id`** (one box = daemon + browser for its slice).
**Option 2 — separate `browser_shard_id` + `browser_shards` registry.**

| | Reuse `shard_id` | Separate `browser_shard_id` |
| --- | --- | --- |
| Migrations | none | 1 table + 3 columns |
| Sizing | locked together | independent: a daemon box holds ~hundreds of light streams, a browser box ~70-100 heavy contexts (RAM-bound) — the ratios differ by ~5-10x, so coupled boxes are sized for the worse of the two |
| Failure coupling | a Chromium OOM/leak that kills the box also drops offer streams (offers are the product; cookies are slower-moving) | browser box death never touches offer streams |
| Rebalance cost | moving a company moves a **live stream** (cost: up to a minute of offers, why `rebalance()` minimises moves, `ShardService.php:97-106`) | moving a browser is cheap: seed from the backend jar, no offers affected |
| Cookie-lineage safety | n/a | n/a |
| Locality benefit | none: daemon and browser talk only via the backend jar, never to each other | none |

There is no data-flow benefit to co-locating them (they exchange cookies through
`FleetSessionService`), and the cost profiles are opposite. **Recommend: separate.**
Rebalancing a daemon is costly and a browser move is nearly free; coupling forces the
conservative rule onto both. The registry is a **new table `browser_shards`** rather than
reusing `daemon_shards`, because the browser registry needs capacity and box-stats columns
the daemon does not, and `daemon_shards` joins are used by `DispatchCommandQueue`.

Small-box convenience stays possible: a host may run `dispatch-daemon` (SHARD_ID=main) and
`uber-auth` (BROWSER_SHARD_ID=main) together; the ids are independent, not tied.

### Registry migration (additive, expand-first, per deploy.yml's rule)

```
browser_shards
  id, name (unique; BROWSER_SHARD_ID), label null, active bool default true,
  max_contexts unsigned int default 60,        -- capacity the box advertises
  last_seen_at ts null,
  stats json null,                              -- box health, section 7
  version string null,                          -- uber-auth build, to spot stale images
  timestamps

uber_fleet_sessions (additive)
  browser_shard_id  fk -> browser_shards, nullOnDelete, indexed
  browser_handoff_until ts null                 -- section 5, rebalance grace
```

Model `BrowserShard` mirrors `DaemonShard` (`DaemonShard.php:19-52`): `STALE_SECONDS = 180`,
`isLive()`, `scopeLive()`, `sessions()` hasMany on `browser_shard_id`.

### Assignment: `BrowserShardService` (a sibling of `ShardService`)

Same three operations as `ShardService.php`, same constants (`REASSIGN_AFTER_SECONDS = 300`,
stale-caller guard `:37-51`):

* `heartbeat(name)` — firstOrCreate by name, stamp `last_seen_at`, set `callerWasStale`.
* `reconcileAssignments()` — assign unassigned companies and those on a dead/drained shard
  to the least-loaded **live** shard. Two differences from the daemon:
  1. **Eligible set = `active` AND `needs_relink`-rescuable**, not just `active`
     (`ShardService.php:81` filters `STATUS_ACTIVE`). The browser serves rescue sessions
     (`SessionBrowserController.php:107, 148-172`), and a rescue must land on the box that
     already holds the warm context, so assignment is **sticky across the active/needs_relink flip**.
  2. **Least-loaded by ratio** `count / max_contexts` and skip shards at 100 %; if every
     shard is full the company stays unassigned and an ops alert fires (same alert path as
     the down-shard mail, `docker-compose.prod.yml:114`). The daemon's ceil(total/live)
     assumes equal boxes; browser boxes can differ in RAM.
* `rebalance()` — ceil(total/live) target with the **fewest moves** (`ShardService.php:107-140`),
  capacity-weighted: target per shard = `min(max_contexts, ceil(total * share))`. Admin-triggered
  only (like the daemon). Adding a box does NOT move existing companies; new/overflow ones
  flow to the empty box, and the owner clicks Rebalance when he wants even load.

Backfill in the migration: a one-time `browser_shards('main')` row and
`update uber_fleet_sessions set browser_shard_id = <main> where status in (active, needs_relink)`,
so the existing single instance keeps owning everything with **zero env changes**.

---

## 3. Shard-aware endpoints (secret guard unchanged)

Identity: header **`X-Browser-Shard-Id`** (default `main` when absent, exactly the daemon's
`X-Shard-Id` leniency, `DispatchDaemonController.php:43, 328-352`). Env: `BROWSER_SHARD_ID`
in `uber-auth/src/config.js`, sent on every call from `backendGet/backendPost`
(`persistent.js:18-39`). The route group stays under `dispatch.secret`
(`routes/api.php:273`). An old image with no header is simply shard `main`.

| Endpoint | Change |
| --- | --- |
| `GET wanted` | `heartbeat(name)` + `reconcileAssignments()`, then BOTH queries (`:101-105` active, `rescuableSessions()` `:150`) get `where browser_shard_id = $shard->id`. Decrypt cost becomes O(slice), not O(1000). Respect `browser_handoff_until` (section 5). Add optional `?known=<tenant:fp,...>` later (phase 4) to omit unchanged jars. |
| `GET rescue` | same shard filter; still ids-only, still one query on the empty answer. Also stamps the heartbeat, throttled to one DB write per 15 s per shard, so a 3 s poll does not turn into a write every 3 s. (Liveness is therefore ~3-15 s fresh, not 60 s.) |
| `POST status` | accepts new top-level `box` object (stats, section 7) updating `browser_shards.stats`; per-row upsert **ignores rows for tenants the caller does not own** (a stale box must not overwrite the owner's state). Batch the tenant resolution (one `whereIn`) — the per-row loop is the first thing that hurts at 1000 rows/20 s fleet-wide. |
| `POST {tenant}/capture` | if header present and `browser_shard_id` set and different => **409 `wrong_shard`** (mirrors `DispatchDaemonController.php:328-335`). The box treats 409 as "not mine any more": close that context, do not retry. This is the split-brain fence on the write side. Missing header (legacy) stays accepted. |

Backwards compatible both directions: new backend + old uber-auth works (shard `main`);
the `main` shard is backfilled, so the old service sees its full set.

---

## 4. Decision B — within-box RAM: shared Chromium, many contexts

### 4.1 Honest cost model (docs/23 said "tens of MB" — measure before trusting it)

In Chromium each **BrowserContext gets its own renderer processes** (profiles never share a
renderer). Sharing one Chromium therefore removes the per-company *browser process + GPU +
network service + utility* overhead (~150-250 MB), not the renderer. The warm driver loads
the Fleet Hub SPA (`warmDriver.js:91-99`), whose renderer is heavy (~100-200 MB) **while
the page is loaded**. Idle `about:blank` renderers are ~20-40 MB. So the saving depends on
one cheap change: **after every keep-warm, navigate the page to `about:blank`** (or close
it and keep only the context + cookies). The hourly cadence (`config.js:37`) means a page
is loaded ~5-10 s per hour per company, so idle memory is what counts.

Planning figures (to be replaced by Phase 0 measurement):

| Quantity | Conservative | Optimistic |
| --- | --- | --- |
| Chromium process base (browser+GPU+net) | 350 MB | 250 MB |
| Idle context (about:blank, cookies, no page) | 90 MB | 40 MB |
| Warm spike while Fleet Hub + dispatch load (per concurrent renew) | 250 MB | 180 MB |
| Today, per company (process each) | 150-350 MB | |

### 4.2 Design: `BrowserPool`

A small module (`uber-auth/src/browserPool.js`, <150 lines) between `persistent.js` and
`launchBrowser()`:

```
BrowserPool { processesPerBox, contextsPerProcess, warmConcurrency }
  acquire()  -> { slot, browser }     least-loaded live process with free capacity;
                                      launches a new one lazily up to processesPerBox
  newCompanyContext(storageState?)    browser.newContext({...stealth opts})   (reuses newStealthContext)
  release(slot)                       slot.count--, context.close() ONLY
  on 'disconnected' (process crash)   mark every entry on that slot DOWN -> existing path
```

Changes are confined to three places and none touch the lifecycle logic:

1. `persistent.js seedFromSession` / `resumeFromDisk`: `launchBrowser()` becomes `pool.acquire()`;
   the entry handle keeps `{ browser, context, page }` plus `slot`.
2. `warmDriver.close` (`:139-141`): `handle.browser.close()` becomes `handle.context.close()`
   and `pool.release(slot)` — it must **never** close the shared browser.
3. `sessionManager.js`: `maxSessions` stays as the per-box guard but is fed from
   `processesPerBox x contextsPerProcess`; `PersistentSessionManager` is otherwise unchanged
   (same states, `releaseIfDead` backoff `:53-57, 321-345`, rescue, revive).

A process dying emits `disconnected`; every entry on it flips to DOWN, and the existing
`releaseIfDead` re-seeds them (first revive is immediate, then 1/5/15 min backoff,
`sessionManager.js:340-345`) onto a fresh process, with a **seeding concurrency limit of 3**
so a crash of a 25-context process does not stampede 25 simultaneous page loads.

### 4.3 Context isolation (cross-tenant leak analysis)

* Cookies, localStorage, IndexedDB, cache, service workers are per-BrowserContext and held
  in memory (incognito-like); nothing is shared on disk. This is the same isolation Playwright
  tests rely on. Each context also uses its own network context, so no shared HTTP/2 sessions
  or connection reuse across tenants.
* `/state/<tenant>.json` stays one file per company (`warmDriver.js:131-137`); the key is
  already the tenant id. Written from `context.storageState()` — per context, no change.
* Residual shared surfaces: DNS cache and the GPU/network utility processes of one Chromium
  (no tenant data); the **identical fingerprint** (section 8). `--disable-features=IsolateOrigins,site-per-process`
  in `browser.js:73` should be dropped in pooled mode: it does not affect context isolation,
  but with 25 tenants in a process it is cheap defence in depth against a renderer exploit;
  re-test that Fleet Hub still loads (OOPIF is on by default in current Chrome).
* Never reuse a context between companies; a context is created from, and torn down with, one
  tenant's entry. A cross-tenant canary test (two contexts, distinct sentinel cookie, assert
  neither `context.cookies()` sees the other's) belongs in the uber-auth tests.

### 4.4 Crash blast-radius and process recycling

One process dying takes its contexts only (not the box). Pool = **N processes x C contexts**
rather than one giant process:

* **C = 25 contexts per process (default), 4 processes per box => 100 hard cap/box.**
  A crash then costs <= 25 companies a re-seed from the backend jar, ~25 x 10 s / 3-way
  concurrency ~ 80 s of no keep-warm for them, which is invisible against an hourly cadence and
  a 24 h `jwt-session`.
* **Recycle** each process after 24 h uptime or RSS > a threshold (Playwright/Chrome long-run
  leaks, docs/23 section 6): drain it by staggering `remove -> seed` of its contexts onto
  another slot at a quiet hour. Stagger across processes so only one recycles at a time.
* A context that stays on `about:blank` between warms plus periodic `process recycle` keeps
  RSS flat; `mem` of each process is reported in the box stats (section 7).

### 4.5 Capacity math (1000 companies)

Per-box RAM = `P x base + (P x C) x idle + K x spike + OS/node 1.0 GB`, with P=4 processes,
C=25 (100 contexts), K = warm concurrency 4 (new `WARM_CONCURRENCY` semaphore in `tick`;
today `tick` is already serial, `sessionManager.js:296-301`, so K is bounded by design).

| Scenario | Base | Idle ctx | Spike | Per-box @100 ctx | Notes |
| --- | --- | --- | --- | --- | --- |
| Conservative | 4 x 350 = 1.4 GB | 100 x 90 = 9.0 GB | 4 x 250 = 1.0 GB | **~12.4 GB** => 16 GB box | |
| Optimistic | 4 x 250 = 1.0 GB | 100 x 40 = 4.0 GB | 4 x 180 = 0.7 GB | **~6.7 GB** => 8 GB box | |

Boxes for 1000 companies (target fill 70 % so a dead box's slice fits in the survivors —
the survivors absorb `slice/(N-1)` each):

| Fill | Contexts/box | Boxes | Spare (N+1) | RAM total |
| --- | --- | --- | --- | --- |
| 70 % of 100 | 70 | 15 | 16 | 16 x 16 GB = 256 GB (conservative) / 16 x 8 GB = 128 GB (optimistic) |
| 100 % of 100 | 100 | 10 | 11 | 176 / 88 GB |

CPU is not the constraint: one keep-warm is ~5 CPU-seconds, 1000 companies hourly is
~0.3 renews/s ~ 1.5 cores fleet-wide steady, ~0.1 core per box. A rescue storm (Uber outage
flags many sessions at once) is bounded by K=4: 70 contexts x ~10 s / 4 ~ 3 min. 4 vCPU/box is
ample. For comparison, today's one-process-per-company design on the same 16 GB boxes holds
~45-60 companies => ~20 boxes for 1000, so pooling halves-to-quarters the fleet and, more
importantly, removes the RAM-linear failure mode. **Step 1 (pooling on the existing box)
alone lifts the 20 cap to roughly 80-100 on the current VPS with no new infra.**

Backend load at 1000: `wanted` becomes O(slice) per box every 60 s (~70 jars decrypted),
`rescue` stays one query per 3 s per box (15 boxes => 5 qps), `status` 1000 rows/20 s = 50 rows/s
batched. All negligible once `status` stops doing per-row lookups.

---

## 5. Lifecycle under sharding

Seed / keep-warm (hourly) / rescue / revive / `releaseIfDead` backoff are **unchanged in
behaviour**; they simply only ever see this shard's rows because `wanted` and `rescue` are
filtered. One required fix: `resumeFromDisk` (`persistent.js:104-130`) currently resumes
every `/state/*.json`. Under sharding it must run **after the first successful `wanted`
fetch** and resume only keys that are in this shard's wanted set; any other state file is a
company that moved away (or lapsed) and is **deleted** (otherwise a restarted box A revives a
context for a company now owned by B => two browsers on one cookie lineage, the exact fork
the one-cookie-lineage prevention exists to avoid).

**Rebalance (admin, like the daemon).** `rebalance()` rewrites `browser_shard_id` and sets
`browser_handoff_until = now + 90 s` on moved rows. A's next `wanted` (within 60 s) no longer
lists the company, so A runs its existing "no longer wanted -> `remove`" path
(`persistent.js:207-212`), which also deletes `/state/<tenant>.json`. B's `wanted` **withholds**
rows still inside `browser_handoff_until`, then returns them and B seeds from the stored jar.
90 s > the 60 s poll, so A has closed before B opens: no overlap, and a gap of ~1-2 min of
keep-warm against a 24 h token (the daemon keeps feeding on the same backend jar throughout —
a rebalance of browsers is invisible to offers). The fresh `capture` 409 fence (section 3) is
the backstop if timing slips.

**Auto-reassign on box death.** After 300 s of silence (`REASSIGN_AFTER_SECONDS`) the next
`wanted`/`rescue` call from any live shard moves the dead shard's companies to live shards
(`reconcileAssignments`). No `browser_handoff_until` is needed (the owner is gone). The new
box seeds each from the backend's stored jar. This is safe and needs **no human for the SOFT
case**, because the backend jar is already the source of truth: the warm driver re-injects it
before every navigation (`warmDriver.js:76-83`), `capture` posts a changed jar immediately
(`persistent.js:42-51`), and the daemon also rolls and stores cookies. What is lost with the
dead box is only its `/state` (a convenience cache) and up-to-one-hour of unposted refresh,
bounded by the keep-warm interval. If the jar is genuinely dead (HARD re-auth) the company is
`needs_relink` regardless of which box holds it — the one-tap relink, unchanged.

**Self-fencing (the split-brain rule).** A box that cannot reach the backend (or gets
repeated non-2xx) for `FENCE_SECONDS = 240` (< 300 reassign) **closes all its contexts and stops
touching Uber** until it reaches the backend again. This mirrors the reasoning in the
`REASSIGN_AFTER_SECONDS` comment (`ShardService.php:23-29`): a partitioned-but-alive box must
not keep rotating a lineage another box now owns. On recovery it re-fetches `wanted` and
seeds only what it still owns.

**Backend/DB outage.** The `callerWasStale` guard (`ShardService.php:33-37, 73`) is copied
verbatim: after an outage the first box back does not grab everyone else's companies.

---

## 6. Config & deploy

Per-box env (new in bold): **`BROWSER_SHARD_ID`** (stable name, default `main`),
**`BROWSER_MAX_CONTEXTS`** (sent to the backend as `max_contexts`, default 60 until measured),
**`BROWSER_PROCESSES`** (default 4), **`BROWSER_CONTEXTS_PER_PROCESS`** (default 25),
**`WARM_CONCURRENCY`** (default 4), `FENCE_SECONDS`. `MAX_SESSIONS` becomes derived/alias
(kept for compatibility). `ONLY_TENANTS` stays as the pilot lever.

* **Step 1, same VPS:** `uber-auth` gets `BROWSER_*` env and a higher shm_size. Extra boxes
  on the same host, if ever needed, are separate **named** services (`uber-auth-2`, ...)
  via a YAML anchor, each with its own `BROWSER_SHARD_ID` and its own state volume.
  `deploy.resources.replicas` is **not** used: replicas share env, and identity must be
  stable (assignment + `/state` are keyed on it).
* **Step 2, separate hosts** (the daemon's model, docs/18 "add a box"): provision a host,
  run the browser-only stack with `BROWSER_SHARD_ID=browser-2`, same `RIDY_API_URL` and
  `DISPATCH_INGEST_SECRET`. The box auto-registers on its first `wanted`, like a daemon.
* **`deploy.yml`:** the main host keeps `uber-auth` in `BUILT_SERVICES` (`:143`) and
  `COMPOSE_PROFILES=browser` (`:323`); no change for the main shard. Remote browser hosts
  are deployed with the same image tag by the box's own `docker compose pull/up` (no new CI
  matrix needed until there are >3 hosts; then add a `uber-auth` host list the way the daemon
  boxes are handled). **Image-skew rule:** a box reports `version` in `stats`; the admin view
  flags a box whose version differs from the backend's expected (the 59-min recovery that was a
  stale `uber-auth` image, HANDOFF 31.10, is the motivation).
* **Compose delta:** `docker-compose.prod.yml` uber-auth env gains the vars above; healthcheck
  hits `/health`; `shm_size` stays (1 g is enough: shm is per Chromium process and Chromium
  needs a few hundred MB, but verify with P=4).

---

## 7. Admin visibility

Extend what exists, do not add a parallel UI:

* Backend: `Admin\BrowserShardController` (`index`, `update`, `rebalance`) mirroring
  `ShardController.php:16-58`: name, label, active, live, `companies`, `max_contexts`,
  fill %, `last_seen_at`, `version`, `stats`. Routes next to `routes/api.php:494-497`:
  `browser-shards`, `browser-shards/{shard}` (drain/label/capacity), `browser-shards/rebalance`.
* The box pushes `stats` inside the existing 20 s `status` post: `{processes, contexts,
  contexts_by_state{active,needs_otp,down,logging_in}, rss_mb_per_process[], mem_total_mb,
  mem_free_mb, warm_queue_depth, renew_p95_ms, recycles_24h, uptime_s}`.
* Super-admin Session tab (`companies/{tenant}/session-browser`, `routes/api.php:540`): per-company
  card gains "box: browser-3"; a new "Browser boxes" panel lists the table above with a
  fill bar (companies / max_contexts), RSS bar, stale-version badge, Drain and Rebalance.
* Alerts (reuse the down-shard mail): box silent > 180 s; fill > 90 %; unassignable
  company (all shards full); version skew; recycle loops (> N crashes/hour).

---

## 8. Migration path (no downtime, no forced relink)

Every step is independently shippable and reversible; the backend is always deployed first
(expand), the uber-auth image second (deploy.yml only recreates `uber-auth` when its image
changed, so a backend-only deploy never reopens a single company's browser).

* **Phase 0 — measure (days, no code risk).** On the live box record per-company RSS
  idle/warm (`pidstat`/`ps` per Chromium), count of `hard_reauth_count`, the cadence of
  hard re-auth per company, and `fleet_session_outages` by `cause`/`via`
  (`2026_10_*_fleet_session_outages` has `cause`). Decide go/no-go with section 9.
* **Phase 1 — shared contexts on ONE box (no new infra).** Ship `BrowserPool`,
  the `close()` fix, `about:blank` after warm, `WARM_CONCURRENCY`. Roll by `ONLY_TENANTS`
  pilot then raise `BROWSER_*` caps. Existing sessions are **not** reseeded en masse: on
  deploy `resumeFromDisk` rebuilds each context from `/state` inside the pool (it already
  resumes warm, `persistent.js:104-132`), with the seeding concurrency limit smoothing the
  restart. Cap 20 -> ~80-100.
* **Phase 2 — registry + shard-aware endpoints, still one box.** Ship `browser_shards`,
  `browser_shard_id` (backfilled to `main`), header-aware `wanted`/`rescue`/`capture`/`status`,
  the `resumeFromDisk`-after-wanted ordering, the 409 fence, self-fencing. Behaviour is
  identical to today because only `main` exists; this is where bugs are cheap.
* **Phase 3 — second box.** Provision `browser-2`; it registers and receives only NEW/overflow
  companies (`reconcileAssignments`), then the owner clicks **Rebalance** in the new admin
  panel when load looks right. Rebalance uses the handoff grace; nothing is relinked.
* **Phase 4 — scale-out + polish.** Add boxes as `fill` crosses 70 %; admin panel, alerts,
  batched `status`, optional conditional `wanted` (`?known=`) once jar payloads show in backend
  CPU; consider a deploy.yml host list past ~3 hosts.

Rollback: Phase 1 flag `BROWSER_PROCESSES=1, BROWSER_CONTEXTS_PER_PROCESS=1` reproduces
process-per-company; Phases 2-3 are additive columns, so reverting the image/controller leaves
shard `main` serving everything.

---

## 9. Risks & open questions

1. **Fingerprint concentration.** 70-100 tenants from one process/IP present one identical
   Chrome 131 / 1280x800 / de-DE / Berlin fingerprint (`browser.js:87-100`); Uber could
   correlate accounts. Mitigation (cheap): a **deterministic per-tenant** variation (viewport
   within a small set, UA minor build) seeded from tenant id so it is stable across restarts —
   a fingerprint that flips on every restart is worse than one fixed one. The owner's stance
   (shared proxy IP and a datacenter IP are fine; sessions originate from the manager's real
   browser anyway) lowers this, but it is the top unknown at 1000; watch outage `cause`
   per box for a correlated clump.
2. **Request volume, not session count, is what Uber sees.** ~1 keep-warm/hour/company is
   tiny; a rescue storm is the only burst (bounded by K). Keep K small and jitter the first
   keep-warm after a (re)start by a random 0-60 min to avoid the whole box landing on the
   same minute forever (today everything seeded together stays in lock-step: `isDue` is
   strictly cadence-based, `sessionManager.js:136-139`).
3. **Playwright limits.** No hard context cap, practical limit is RAM and the CDP event loop
   of one Node process (the manager is a single Node event loop: 100 contexts hourly is trivial,
   but `storageState()` of 100 large contexts in a burst blocks briefly — stagger saves).
   Stability over days: leaks => recycle (4.4). Node `uber-auth` should stay a single process
   per box; a second Node process per box is needed only if `renew_p95_ms` degrades.
4. **Split brain** (two boxes holding one lineage) is the worst failure: guarded by
   the grace window, `resumeFromDisk` ownership filter, 409 on capture, self-fencing
   (section 3, 5). Needs explicit tests: partitioned box, box restart mid-rebalance, stale
   `/state` after a move.
5. **`session_browsers` has one row per tenant**, and `status`/`capture` can arrive from two
   boxes during a move; the ownership filter in section 3 makes the owner the only writer.
6. **Do we need warm-for-all at all? (the strategic fork).** The owner is weighing
   "measure the hard-re-auth cadence first" (docs/23 section 7 step 1; memory:
   session-monthly-reauth-needs-human). The browser's proven value is repairing SOFT deaths and
   assisting relink; it cannot defeat the ~monthly HARD re-auth. If Phase 0 shows soft deaths are
   rare per company-month, a **rescue-on-demand pool** (a context opened only when
   `wanted`/`rescue` flags a company, closed after it heals; hourly warm only for the 10-20 %
   historically flaky companies) cuts the 1000-company requirement by ~5-10x (to 1-3 boxes) and
   makes most of this document a Phase 1-only story. Metrics that decide it, all available
   today: (a) soft-death count per company-month with vs without the browser (outage table,
   `cause`/`via=browser`); (b) share of recoveries done by the browser vs a human relink;
   (c) hard-re-auth interval distribution (`session_browsers.hard_reauth_count`, last_login_at);
   (d) idle vs warm RSS from Phase 0. **Recommendation: do Phase 0 + Phase 1 regardless
   (cheap, no new infra, fixes the 20 cap), and gate Phases 2-4 on (a)-(c).**
7. **Hard limits recheck.** Nothing here adds a stored credential, OTP automation or an Uber
   write; sharding only decides which of our own boxes holds a context. DSGVO unchanged: no
   new data collected, only `stats` about our own boxes.
