# 16 · Server Migration Handoff (Reidey)

**Status:** Ready to execute when the new box is provisioned. Nothing here has been
run yet. Follow it top to bottom on migration day.

**Why we migrate:** the current app box (2 vCPU / 8 GB / 100 GB) is too small to
self-host Germany geocoding (Nominatim + OSRM) alongside the app — the OSM import
filled the disk and crashed the stack. Geo self-hosting is **parked** until we move
to a bigger box.

---

## 0. TL;DR — what actually changes

The whole platform is a `docker compose` stack driven by a **GitHub Actions deploy**
that provisions any fresh Linux box over SSH (installs Docker, clones the repo,
writes `.env` from secrets, builds, migrates). So migrating = **point the deploy at
a new server + move the MySQL data**. No code changes.

Three moving parts to carry over:

1. **The repo** — GitHub already has it; the new box clones it automatically.
2. **The `.env` secrets** — already in GitHub Actions secrets; just repoint `SSH_HOST`.
3. **The MySQL data** — the ONLY stateful thing. Dump on old box, restore on new box.

Everything else (containers, Caddy TLS, scheduler, queue, daemon) rebuilds from
scratch on the new box.

---

## 1. Target box

| Tier | Spec | Good for | Monthly |
|---|---|---|---|
| **Start here** | Hetzner **CCX33** — 8 vCPU / 32 GB / 240 GB NVMe | app + DB + geo + daemon, ~100–300 companies | ~€50–70 |
| More runway | Hetzner **CCX43** — 16 vCPU / 64 GB / 360 GB NVMe | same, comfortable to ~500 companies | ~€110 |

- **Region:** Germany (Falkenstein/Nuremberg) — DSGVO + low latency to German OSM/Uber traffic.
- **OS:** Ubuntu 24.04 LTS (the deploy also supports AlmaLinux/RHEL via dnf).
- **Disk headroom is the point:** the Germany OSM import needs ~30–40 GB working
  space + the final Nominatim DB. 240 GB NVMe leaves plenty; never run geo on <120 GB free.

> For **1000 companies** one box is not enough — see §7 (split architecture). Start
> single, split as load demands. The stack is built to split without rewrites.

---

## 2. Pre-flight (do this the day before, zero downtime)

1. **Provision the new box**, note its public IP.
2. **SSH key:** make sure the same key in the `SSH_KEY` GitHub secret can log into
   the new box as the deploy user (root or a sudo user). Test: `ssh USER@NEW_IP echo ok`.
3. **Firewall:** open 22, 80, 443. (Hetzner Cloud Firewall or `ufw`.)
4. **Confirm GitHub secrets exist** (Settings → Secrets and variables → Actions).
   These already drive production; nothing to change except `SSH_HOST` at cutover:
   - `SSH_HOST` `SSH_USER` `SSH_KEY` (or `SSH_PASSWORD`) `SSH_PORT`
   - `REPO_URL` `DOMAIN`
   - `APP_KEY` — **must be the same value as the live box** (see §3, critical).
   - `DB_PASSWORD` `DB_ROOT_PASSWORD` `DISPATCH_INGEST_SECRET`
   - `FCM_CREDENTIALS_JSON` `FCM_PROJECT_ID`
   - `NOMINATIM_URL` `OSRM_URL` — set these to enable geo (see §6).

---

## 3. ⚠️ Critical: preserve `APP_KEY`

The deploy auto-generates an `APP_KEY` on first run and stores it at
`$HOME/ridy/.app_key` so it never rotates. A **new** key makes all previously
encrypted data (tokens, anything encrypted) undecryptable.

**Before cutover, copy the live key into the GitHub `APP_KEY` secret** so the new
box reuses it instead of generating a fresh one:

```bash
# On the OLD box:
cat ~/ridy/.app_key
# Copy the whole "base64:...." string into the GitHub secret APP_KEY.
```

If `APP_KEY` is set as a secret, the deploy uses it verbatim — no rotation. Do this
and the migration is safe.

---

## 4. Move the MySQL data (the only stateful step)

The DB lives in the `dbdata` docker volume. Dump it on the old box, restore on the new.

### 4a. Dump on the OLD box

```bash
cd ~/ridy
# Consistent logical dump of the app DB.
docker compose -f docker-compose.prod.yml exec -T mysql \
  mysqldump -uroot -p"$DB_ROOT_PASSWORD" \
  --single-transaction --quick --routines --triggers ridy \
  | gzip > ~/ridy-db-$(date +%F).sql.gz

ls -lh ~/ridy-db-*.sql.gz          # sanity: non-trivial size
```

Copy the dump to your laptop (or straight to the new box):

```bash
# From your laptop:
scp OLDUSER@OLD_IP:~/ridy-db-*.sql.gz .
scp ridy-db-*.sql.gz NEWUSER@NEW_IP:~/
```

### 4b. Bring the new box up EMPTY first

Point the `SSH_HOST` secret at the new IP and run the deploy (§5). It builds the
stack and runs migrations on an empty DB — that's fine, we overwrite it next.

### 4c. Restore on the NEW box

```bash
cd ~/ridy
# Stop app writers so nothing races the import (leave mysql up).
docker compose -f docker-compose.prod.yml stop backend queue scheduler dispatch-daemon

gunzip -c ~/ridy-db-*.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T mysql \
  mysql -uroot -p"$DB_ROOT_PASSWORD" ridy

# Re-run migrations in case new box is a newer schema, then restart writers.
docker compose -f docker-compose.prod.yml exec -T backend php artisan migrate --force
docker compose -f docker-compose.prod.yml up -d
```

> **Freshness:** dump as late as possible before cutover. Offers/live status are
> high-churn — a stale dump loses recent trips. Best practice: put the site in a
> short maintenance window, dump, restore, cutover DNS, done in minutes.

---

## 5. Cutover (repoint deploy + DNS)

1. **GitHub secret `SSH_HOST`** → new box IP. (If SSH port/user differ, update those too.)
2. **Run the deploy:** push any commit to `main`, or GitHub → Actions → *Deploy* →
   Run workflow. It installs Docker, clones, writes `.env`, builds, starts, migrates.
3. **DNS:** point `reidey.de` (and any subdomain) A-record at the new IP. Caddy
   auto-issues Let's Encrypt TLS once DNS resolves and 80/443 are open.
4. Wait for DNS TTL. Lower the TTL to 300s a day earlier for a fast switch.

Watch it:

```bash
gh run watch "$(gh run list --workflow=Deploy --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

---

## 6. Enable self-hosted geo (the reason we moved)

Geo lives behind a compose profile so the app can run without it. On the roomy box:

1. **Set the GitHub secrets** so the backend calls the local services:
   - `NOMINATIM_URL=http://nominatim:8080`
   - `OSRM_URL=http://osrm:5000`
2. **Import Germany OSM** (one-time, heavy — hours, tens of GB). Do it on the box:

```bash
cd ~/ridy
# Start geo with the profile; nominatim self-imports Germany on first run.
docker compose -f docker-compose.prod.yml --profile geo up -d nominatim osrm

# Watch the import; it is done when /status returns 200.
docker compose -f docker-compose.prod.yml logs -f nominatim
```

3. **Verify** before pointing the app at it:

```bash
curl 'http://NEW_IP:8080/search?q=Berlin&format=json&limit=1'   # Nominatim
curl 'http://NEW_IP:5000/route/v1/driving/13.4,52.5;13.4,52.6'  # OSRM
```

4. Redeploy so the backend picks up `NOMINATIM_URL`/`OSRM_URL`, then confirm new
   offers geocode (dashboard shows German addresses + €/km, not `—`).

> **Disk watch during import:** `df -h` in another terminal. If free space dips
> below ~20 GB, stop and reassess — do NOT let it fill (that's what killed the old
> box). Standalone `docker-compose.geo.yml` + `docs/self-hosted-geo.md` cover
> running geo on a *separate* dedicated box instead.

---

## 7. Scaling to 1000 companies — split architecture

One 32 GB box is a great start but won't carry 1000 companies at peak. Split in
this order, each piece independently, as load demands. The stack already supports it:

| Component | Why it splits first | How |
|---|---|---|
| **MySQL** | Highest write load (offers + status every 10s × drivers); first to hurt | Move to a dedicated DB box (16–32 GB, NVMe) or managed MySQL. Point `DB_HOST` at it. |
| **Geocoding** | RAM/CPU hungry, competes with the app | Own box via `docker-compose.geo.yml`; set `NOMINATIM_URL`/`OSRM_URL` to it. |
| **dispatch-daemon** | ~1 persistent stream/company + ~100 req/s outbound | Shard: run N daemon instances, ~200–300 companies each, partitioned by tenant. |
| **Redis** | Queue + cache under load | Add a Redis box; switch queue/cache drivers. |
| **App (backend/frontend)** | Stateless — scales horizontally | Multiple app boxes behind a load balancer. |

Rough capacity read: watch `docker stats` and MySQL slow-query log. When the DB
sustains high CPU or the daemon's memory climbs, that component is the one to peel
off next.

---

## 8. Rollback

Until DNS fully propagates and you've verified the new box, the **old box stays
untouched and serving**. If anything is wrong:

1. Revert the `reidey.de` A-record to the OLD IP.
2. Revert the `SSH_HOST` secret to the OLD IP.

Because DNS is the switch, rollback is just changing the record back. Keep the old
box running for **48–72 h** after cutover before decommissioning, and keep the DB
dump archived.

---

## 9. Post-cutover verification checklist

- [ ] `https://reidey.de` loads with valid TLS (Caddy issued the cert).
- [ ] `curl https://reidey.de/up` → 200.
- [ ] Login to dashboard works (Sanctum cookie/session).
- [ ] Driver-app login works (bearer token) — test driver #139 (`driver139@reidey.de`).
- [ ] A captured offer appears in the dashboard and pushes a notification with
      distance + €/km.
- [ ] Addresses render in German, per-km is a number (geo live).
- [ ] `docker compose -f docker-compose.prod.yml ps` — all Up, mysql healthy.
- [ ] `df -h` — comfortable free space after the geo import.
- [ ] Scheduler + queue running (`offers:backfill-geo` fires every 5 min).

---

### Handy references
- Deploy internals: `.github/workflows/deploy.yml`
- Prod stack: `docker-compose.prod.yml` (services: caddy, mysql, backend, scheduler, queue, frontend, dispatch-daemon, nominatim, osrm under `geo`)
- Standalone geo box: `docker-compose.geo.yml` + `docs/self-hosted-geo.md`
- General deploy notes: `docs/13-deployment.md`
