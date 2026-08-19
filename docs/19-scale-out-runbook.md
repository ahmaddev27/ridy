# 19 · Scale-Out Runbook (to 1000 companies)

## ملخّص بالعربي (اقرأ هذا أولاً)

- **التوزيع تلقائي**: كل شركة جديدة (خلال 500 → 1000) بتنمسك تلقائياً من الشارد صاحب
  حصّتها خلال ≤60 ثانية من ربطها — **بلا نشر، بلا توقّف، بلا فقدان بيانات**.
- **السرّ**: ثبّت `SHARD_COUNT=4` **من بداية الإطلاق** وشغّل 4 بوكسات ديمون. وقتها
  500→1000 شركة بتتوزّع على الأربعة بلا أي تغيير منك.
- **اللي مطلوب منك يدوياً** (مرّة، مش لكل شركة): تجهيز البوكسات ونشرها أول مرة، وفصل
  DB/الجيو على بوكسات، وربط البروكسي لكل شركة (أو أتمتته).
- **الشي الوحيد اللي بيسبّب إعادة توزيع**: تغيير `SHARD_COUNT` (تضيف شارد خامس). لهيك
  نبدأ بـ4 لتغطية 1000، فما تحتاج تغيّره أثناء الإطلاق.

---

## 1. Target topology (launch phase, ~1000 companies)

```
                    Cloudflare (DNS + TLS + DDoS)
                              │
                    ┌─────────▼──────────┐
                    │  MAIN box (RS 4000) │  app + Caddy + queue + scheduler
                    └───┬───────────┬─────┘
             DB_HOST │           │ NOMINATIM_URL / OSRM_URL
              ┌──────▼─────┐  ┌───▼────────┐
              │ DB box     │  │ GEO box    │  MySQL(+Redis) │ Nominatim+OSRM
              └────────────┘  └────────────┘
                    ▲  ▲  ▲  ▲   (all POST to MAIN's API)
        ┌───────────┴┐ ┌┴───────────┐ ┌┴───────────┐ ┌┴───────────┐
        │ daemon sh0 │ │ daemon sh1 │ │ daemon sh2 │ │ daemon sh3 │  RS 2000 each
        └────────────┘ └────────────┘ └────────────┘ └────────────┘
         ~250 companies each · SHARD_COUNT=4 · one proxy per company
```

- **Main / DB / Geo are single shared services** — they do NOT shard.
- **Only the daemon fans out** — 4 shard boxes, `sessionId % 4` picks the owner.

## 2. What scales AUTOMATICALLY (zero-touch)

Once the 4 shards are running with `SHARD_COUNT=4`:

- **A new company onboards** (manager clicks Connect → session captured). On the
  next 60s poll, the shard that owns `sessionId % 4` starts its streams. No
  deploy, no restart, no downtime. This is the whole 500→1000 ramp — it just fills
  the existing shards.
- **Load balances itself** across the 4 shards because ids distribute evenly.
- **The daemon is stateless**: it re-derives which streams to hold from the DB
  session list every poll. A shard box reboot just reconnects and resumes — the
  sessions, offers and data live in MySQL and are never lost.
- **Offers already flow the same path** — shard → MAIN API → match driver → FCM.

> So during launch you do **nothing per company**. Onboarding (capturing each
> Uber session) + assigning each company a proxy is the only per-company work,
> and that's product/ops, not infra.

## 3. What you do MANUALLY (once, not per company)

### 3a. Provision boxes (Netcup RS, Nürnberg, Ubuntu 24.04)
- 1× MAIN (RS 4000) · 1× DB (RS 4000) · 1× GEO (RS 3000/4000) · 4× daemon (RS 2000).
- `ufw allow 22,80,443` on MAIN; DB/GEO boxes only need 22 + their service port open **to the other boxes' IPs** (never the public internet).

### 3b. Split DB + geo off the MAIN box
- **DB box:** run MySQL there; set `DB_HOST=<db-box-ip>` (+ `DB_PORT`) in the deploy
  `.env` and open 3306 only to the MAIN box IP. Add Redis for queue/cache.
- **Geo box:** run `docker-compose.geo.yml`; set `NOMINATIM_URL`/`OSRM_URL` secrets
  to it. (Backend already reads these — no code change.)
- Redeploy MAIN so the backend points at the external DB + geo.

### 3c. Deploy the 4 daemon shard boxes
On each shard box, create a `.env` and run the daemon-only stack:

```bash
# /root/reidey/.env on shard box N (N = 0..3)
RIDY_API_URL=https://reidey.de
DISPATCH_INGEST_SECRET=<same as backend>
SHARD_INDEX=N
SHARD_COUNT=4

# then, from the repo checkout on that box:
docker compose -f docker-compose.daemon-shard.yml up -d --build
```

Each logs `... [shard N/4] ...` on start. Turn OFF the daemon on the MAIN box so
it isn't a 5th holder:
```bash
docker compose -f docker-compose.prod.yml up -d --scale dispatch-daemon=0
```
(or keep MAIN as shard 0 of 4 and run only 3 extra boxes — your call on capacity.)

### 3d. Proxies — the real work
Every company needs its **own** proxy (one Uber account per IP). Before/at
onboarding each company, buy + bind a proxy (the backend already stores
`proxy_url` per company and the daemon uses it). At 1000 companies automate the
purchase+bind; this is the dominant cost (~$6,600/mo), unaffected by sharding.

## 4. Adding capacity LATER (the only re-partition event)

If you outgrow 4 shards (past ~1000), you add a 5th:
1. Provision daemon box 4.
2. Change `SHARD_COUNT` to 5 on **every** shard box (and MAIN if it participates).
3. Roll them: each shard re-computes its slice; streams for reassigned companies
   stop on the old owner and start on the new one within one poll.

This briefly reconnects the reassigned companies' streams (seconds), so do it in a
**quiet window**. This is why we start at `SHARD_COUNT=4` — it covers the full
launch to 1000 with **no** re-partition needed.

## 5. Guarantees & failure modes

| Event | Effect | Recovery |
|---|---|---|
| Shard box reboot/crash | only its ~250 companies miss offers meanwhile | restarts → reconnects from DB session list, resumes; no data lost |
| New company mid-launch | picked up ≤60s, auto | none needed |
| MAIN box down | ingestion + dashboard down | restore MAIN; sessions/offers safe in DB box |
| DB box down | writes fail | restore; keep DB backups (this is the critical box) |
| Changing SHARD_COUNT | brief re-partition (seconds) | do in a quiet window |

**No offer is stored on the daemon** — it's a relay. State lives in MySQL, so
box restarts never lose data; the worst case is a few seconds of missed offers
for one shard's slice during its own restart.

## 6. Cost recap

| Item | Monthly |
|---|---|
| 7 Netcup RS boxes | ~€180–220 |
| Cloudflare / FCM / email | ~$0–20 |
| **Proxies (1000 × $6.60)** | **~$6,600** ← dominant |
| **Total @ 1000** | **~$7,000** |

Servers are cheap; the proxy bill is the real ceiling. Sharding buys daemon
capacity for a few cheap boxes and changes nothing else.

### References
- Sharding internals: `docs/18-daemon-sharding.md`
- Shard box stack: `docker-compose.daemon-shard.yml`
- Geo box: `docker-compose.geo.yml` + `docs/self-hosted-geo.md`
- Migration/provisioning: `docs/16-server-migration-handoff.md`
