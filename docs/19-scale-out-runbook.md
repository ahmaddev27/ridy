# 19 · Scale-Out Runbook (to 1000 companies)

## ملخّص بالعربي (اقرأ هذا أولاً)

- **التوزيع تلقائي**: كل شركة جديدة (خلال 500 → 1000) بتنمسك تلقائياً من الشارد صاحب
  حصّتها خلال ≤60 ثانية من ربطها — **بلا نشر، بلا توقّف، بلا فقدان بيانات**.
- **السرّ**: شغّل بوكسات ديمون كل واحد بـ`SHARD_ID` مختلف. الباك بيوزّع كل شركة على
  **الشارد الأقل حِملاً تلقائياً**، فـ500→1000 شركة بتتوزّع لحالها بلا أي تغيير منك.
- **إضافة بوكس = صفر توقّف**: البوكس الجديد بياخد الشركات الجديدة (least-loaded)،
  والقديمة **ما بتتنقل** (إلا لو ضغطت Rebalance بلوحة الأدمن). **مافي re-partition إجباري.**
- **auto-failover**: لو بوكس وقع (بلا heartbeat >180 ثانية) → شركاته بتنتقل تلقائياً
  لبوكس حي على الاستطلاع التالي.
- **اللي مطلوب منك يدوياً** (مرّة، مش لكل شركة): تجهيز البوكسات ونشرها، وفصل DB/الجيو،
  وربط البروكسي لكل شركة (أو أتمتته). والتحكّم من **لوحة Shards** (drain/rebalance).

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
         ~250 companies each · distinct SHARD_ID · one proxy per company
```

- **Main / DB / Geo are single shared services** — they do NOT shard.
- **Only the daemon fans out** — N shard boxes (each a distinct `SHARD_ID`); the
  backend assigns each company to the least-loaded live shard.

## 2. What scales AUTOMATICALLY (zero-touch)

Once the shard boxes are running (each a distinct SHARD_ID):

- **A new company onboards** (manager clicks Connect → session captured). On the
  next 60s poll, the backend assigns it to the least-loaded live shard and that box
  starts its streams. No deploy, no restart, no downtime — the whole 500→1000 ramp
  just fills the running shards.
- **Load balances itself** — new companies always land on the emptiest live shard.
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
# /root/reidey/.env on each shard box — a UNIQUE name per box
RIDY_API_URL=https://reidey.de
DISPATCH_INGEST_SECRET=<same as backend>
SHARD_ID=shard-2      # shard-3, shard-4, … on the others

# then, from the repo checkout on that box:
docker compose -f docker-compose.daemon-shard.yml up -d --build
```

Each logs `... [shard "shard-2"] ...` on start and auto-registers. The MAIN box's
daemon stays as shard `main`; the extra boxes just add capacity, and new companies
spread across all live shards. (To drain `main` off later, set it inactive in the
admin Shards page.)

### 3d. Proxies — the real work
Every company needs its **own** proxy (one Uber account per IP). Before/at
onboarding each company, buy + bind a proxy (the backend already stores
`proxy_url` per company and the daemon uses it). At 1000 companies automate the
purchase+bind; this is the dominant cost (~$6,600/mo), unaffected by sharding.

## 4. Adding capacity LATER (zero-downtime)

Outgrew your shards? Just add a box:
1. Provision another daemon box.
2. Deploy the daemon-only stack with a **new `SHARD_ID`**.

That's it. It registers on first poll and **new** companies start landing on it
(it's the emptiest live shard). **Existing companies are not moved** — no
re-partition, no downtime. If you want to spread the *existing* load onto it too,
click **Rebalance** in the admin Shards page (a brief, deliberate reshuffle).

## 5. Guarantees & failure modes

| Event | Effect | Recovery |
|---|---|---|
| Shard box reboot/crash | only its ~250 companies miss offers meanwhile | restarts → reconnects from DB session list, resumes; no data lost |
| New company mid-launch | picked up ≤60s, auto | none needed |
| MAIN box down | ingestion + dashboard down | restore MAIN; sessions/offers safe in DB box |
| DB box down | writes fail | restore; keep DB backups (this is the critical box) |
| Shard box dies (stale >180s) | its companies auto-reassign to live shards | box returns → optional Rebalance to re-spread |
| Admin Rebalance | brief reshuffle of stream ownership | run in a quiet window |

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
