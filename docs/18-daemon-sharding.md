# 18 · Dispatch-Daemon Sharding

**Status:** Implemented and safe to ship. Default is a single shard that owns
every company, so nothing changes until you deliberately scale out.

## What it is

The `dispatch-daemon` holds one live Uber dispatch stream **per company** (per
captured session), routed through that company's dedicated proxy. One Node
process cannot hold ~1000 persistent streams + timers + proxy sockets, so we
**shard**: run N daemon instances, each owning a fixed slice of companies.

Partition is by session id, with no coordinator and no overlap:

```
this shard owns company  ⇔  sessionId % SHARD_COUNT === SHARD_INDEX
```

Every shard polls the full session list from the backend (`api.sessions()`) but
only starts streams for its own slice. Adding/removing a company just changes
which shard's slice it lands in on the next poll (default every 60s).

## How to run it

Two env vars (both default to a single all-owning shard):

| Var | Meaning |
|---|---|
| `SHARD_COUNT` | total number of daemon instances (N) |
| `SHARD_INDEX` | this instance's index, `0 .. N-1` |

The daemon refuses to start on an invalid combination (index out of range, count < 1).

### Option A — several shards on one box (compose)

`docker-compose.shards.yml` (create when needed) with one service per shard, all
built from the same image, differing only by `SHARD_INDEX`:

```yaml
services:
  daemon-0:
    extends: { file: docker-compose.prod.yml, service: dispatch-daemon }
    environment: { SHARD_INDEX: 0, SHARD_COUNT: 4 }
  daemon-1:
    extends: { file: docker-compose.prod.yml, service: dispatch-daemon }
    environment: { SHARD_INDEX: 1, SHARD_COUNT: 4 }
  # daemon-2 (index 2), daemon-3 (index 3) …
```

### Option B — shards across boxes (real scale)

Each daemon box runs one container with its own `SHARD_INDEX` and the shared
`SHARD_COUNT`. This is the 1000-company topology: e.g. 4 daemon boxes × 250
companies. The backend/DB/geo stay single, shared services — only the daemon
fans out.

> **Rule:** every shard must use the **same `SHARD_COUNT`**. Changing N
> re-partitions everyone (streams briefly stop on the old shard and start on the
> new one) — do it during a quiet window.

## How it changes the flow

Nothing about the offer path changes — it just spreads the *stream-holding* work:

```
                         ┌─ daemon shard 0  (companies where id%N==0) ─┐
Uber dispatch streams ───┼─ daemon shard 1  (id%N==1) ─────────────────┼──▶ same backend API
                         ├─ daemon shard 2  (id%N==2) ─────────────────┤     (match driver +
                         └─ daemon shard 3  (id%N==3) ─────────────────┘      push FCM) → 1 DB
```

- **One brain, many arms:** backend (Laravel), MySQL and geo remain single shared
  services. Only the daemon is replicated.
- **Isolation:** if a shard box dies, only its slice of companies misses offers
  until it restarts — not the whole fleet.
- **No app/DB/proxy change:** each company still has its own proxy; sharding only
  distributes *which* daemon holds it. The proxy count is unchanged.

## What it costs

Sharding itself is just more daemon instances — cheap CPU/RAM, no licences.

| Item | Cost impact |
|---|---|
| Daemon boxes | +1 small box per ~250 companies (e.g. 4 boxes for 1000). On Netcup RS that's modest (~€30/box). |
| Backend / DB / geo | **No change** from sharding (shared). DB may still need its own box at scale for other reasons. |
| **Proxies** | **No change from sharding** — still one proxy per company (~$6.60 each). This remains the dominant cost (1000 × $6.60 ≈ $6,600/mo), independent of how many shards hold them. |
| Engineering | Done — this doc + the two env vars. |

**Takeaway:** sharding removes the daemon bottleneck for a few extra cheap boxes.
It does **not** change the proxy bill, which stays the biggest line item at scale.

## Verify

```bash
# Distribution is even (example: 4 shards):
node -e "const N=4;let c=[0,0,0,0];for(let i=1;i<=1000;i++)c[((i%N)+N)%N]++;console.log(c)"
# → [250, 250, 250, 250]
```

Each shard logs its identity on start: `Ridy dispatch daemon starting [shard 2/4] -> …`.
