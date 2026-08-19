# 18 · Dispatch-Daemon Sharding

**Status:** Implemented and safe to ship. Default is a single shard named `main`
that owns every company, so nothing changes until you add a box.

## What it is

The `dispatch-daemon` holds one live Uber dispatch stream **per company**, routed
through that company's dedicated proxy. One Node process cannot hold ~1000
persistent streams, so we **shard**: run N daemon boxes, each owning a slice of
companies.

The scheme is **DB-driven and self-healing** (not a static modulo):

- Each daemon box identifies itself by a stable **`SHARD_ID`** name and heartbeats
  on every poll (auto-registering in the `daemon_shards` table).
- The backend assigns each active company to the **least-loaded live shard** and
  returns to each box only its own slice (`GET /internal/dispatch/sessions` filters
  by the `X-Shard-Id` header).
- **Add a box** → give it a new `SHARD_ID`; new companies flow to it because it's
  the least loaded. **Existing companies are not re-partitioned** — zero disruption.
- **A box dies** (no heartbeat for `DaemonShard::STALE_SECONDS` = 180s) → its
  companies are reassigned to live shards on the next poll. **Auto-failover.**

## How to run it

One env var per box:

| Var | Meaning |
|---|---|
| `SHARD_ID` | this box's shard name. One box → `main`. More boxes → unique per box (`shard-2`, …). |

- **Single box** (default): the prod compose sets `SHARD_ID=main`; that shard owns
  everything. No action.
- **Add a box:** provision it, deploy the daemon-only stack with a new `SHARD_ID`:

```bash
# /root/reidey/.env on the new shard box
RIDY_API_URL=https://reidey.de
DISPATCH_INGEST_SECRET=<same as backend>
SHARD_ID=shard-2

docker compose -f docker-compose.daemon-shard.yml up -d --build
```

It registers on first poll and starts receiving newly-onboarded companies. To move
existing companies onto it too, hit **Rebalance** in the admin (below).

## Admin control

Super-admin endpoints (dashboard "Shards"):

| Endpoint | Action |
|---|---|
| `GET  /api/v1/admin/shards` | list every shard: company count, live?, last seen |
| `PATCH /api/v1/admin/shards/{id}` | drain (`active=false`) or label a shard |
| `POST /api/v1/admin/shards/rebalance` | evenly redistribute all companies across live shards |

Draining a shard (`active=false`) stops new assignments to it; its companies move
to other live shards on the next poll — a clean way to retire a box.

## How it changes the flow

Nothing on the offer path changes — it just spreads the *stream-holding* work:

```
Uber dispatch streams ──┬─ daemon "main"    (its assigned companies) ─┐
                        ├─ daemon "shard-2" (its assigned companies) ─┼──▶ same backend API
                        └─ daemon "shard-3" (its assigned companies) ─┘     (match + FCM) → 1 DB
```

- **One brain, many arms:** backend, MySQL and geo stay single shared services.
- **Stateless daemon:** each box re-derives its streams from the assigned session
  list every poll; a restart just reconnects. State lives in MySQL — never lost.
- **No re-partition event:** unlike a modulo scheme, adding/removing a box never
  forces a global reshuffle. New companies fill the new box; a dead box's companies
  fail over; admin can rebalance on demand.

## What it costs

| Item | Cost impact |
|---|---|
| Daemon boxes | +1 small box per ~250 companies (Netcup RS ~€15–30/box). |
| Backend / DB / geo | **No change** from sharding (shared). |
| **Proxies** | **No change** — still one proxy per company (~$6.60). This stays the dominant cost at scale, independent of shard count. |

**Takeaway:** sharding removes the daemon bottleneck for a few cheap boxes, with
auto-assignment + auto-failover, and never re-partitions live traffic.
