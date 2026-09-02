# Self-hosted geocoding + routing (Nominatim + OSRM)

Trip distance / price-per-km come from geocoding the pickup+dropoff addresses
(Nominatim) and routing between them (OSRM). By default `TripGeocoder` uses the
**free public** services, which are rate-limited to roughly 1 request/second and
will throttle or block a busy server. At scale (hundreds of companies) offers
pile up without a distance.

This guide sets up **self-hosted** Nominatim + OSRM for Germany, which removes
all rate limits (you own the throughput). The services are defined in
`docker-compose.prod.yml` behind the `geo` profile, so a normal deploy never
touches them — you import once, then flip two env vars.

Reaching them: the backend talks to `http://nominatim:8080` and
`http://osrm:5000` over the compose network (same network, service names).

## Requirements (Germany extract)

- Disk: ~**80–100 GB** free (Nominatim DB ~60 GB, OSRM graph + PBF ~10 GB).
- RAM: **8 GB+** recommended for the Nominatim import.
- Time: the Nominatim import runs for **several hours**.

Everything below runs on the server, in the repo dir (`$HOME/ridy`).

---

## 1. Import Nominatim (Germany)

The `mediagis/nominatim` image imports the PBF named in `PBF_URL` on first boot
(already wired in compose to Geofabrik `germany-latest`). Just start it under the
profile and let it import:

```bash
docker compose -f docker-compose.prod.yml --profile geo up -d nominatim
# Watch the import (hours). Ready when you see "database system is ready".
docker compose -f docker-compose.prod.yml logs -f nominatim
```

Verify when done:

```bash
curl "http://localhost:8080/search?q=Alexanderplatz,Berlin&format=json&limit=1"
# (only works if you temporarily publish the port; otherwise test from the backend below)
```

The imported DB persists in the `nominatim_data` volume, so it survives restarts.

---

## 2. Build the OSRM graph (Germany), then serve it

OSRM preprocesses the PBF into a routing graph (MLD pipeline: extract → partition
→ customize), and the compose `osrm` service serves it with `--algorithm mld`.

> ### ⛔ Two rules learned the hard way — breaking either gives **garbage distances**
> 1. **NEVER interrupt a build step (no Ctrl+C).** An interrupted `osrm-extract`
>    leaves a corrupt graph that still *serves* routes but returns absurd distances
>    (a 3 km trip → 100 000+ km), and a missing `.osrm.timestamp` cannot be faked
>    (it's an OSRM tar container, not plain text). A clean, uninterrupted build is
>    the only fix. Run the whole pipeline as **one detached job**.
> 2. **The `osrm/osrm-backend` image has no `curl`** — download the PBF with a
>    throwaway `alpine + wget` container, not `curl` inside the osrm image.

**One detached command — build, verify a real route, and switch the backend only if
the distance is sane** (otherwise it leaves the app on public OSM, so a bad build
never reaches production). Run it, then walk away and read the log when it finishes:

```bash
cat > /root/ridy/osrm-build.sh <<'SCRIPT'
#!/bin/bash
set -e
cd /root/ridy
V=ridy_osrm_data; IMG=osrm/osrm-backend:latest
C="docker compose -f /root/ridy/docker-compose.prod.yml"
log(){ echo "[$(date '+%F %T')] $*"; }
log "wipe + download germany pbf (~4GB) via alpine+wget (osrm image has no curl)"
$C --profile geo stop osrm || true
docker run --rm -v $V:/data alpine sh -c "rm -rf /data/*"
docker run --rm -v $V:/data alpine sh -c "apk add --no-cache wget ca-certificates && wget -q -O /data/germany-latest.osm.pbf https://download.geofabrik.de/europe/germany-latest.osm.pbf"
log "extract (car profile) -> partition -> customize  (DO NOT interrupt)"
docker run --rm -v $V:/data $IMG osrm-extract -p /opt/car.lua /data/germany-latest.osm.pbf
docker run --rm -v $V:/data $IMG osrm-partition /data/germany-latest.osrm
docker run --rm -v $V:/data $IMG osrm-customize /data/germany-latest.osrm
$C --profile geo up -d osrm
set +e
log "verify a real route BEFORE switching (Herdecke->Wetter, expect ~9000 m)"
JSON=""; for i in $(seq 1 8); do sleep 20; JSON=$(docker run --rm --network container:ridy-backend-1 curlimages/curl:latest -s "http://osrm:5000/route/v1/driving/7.4052,51.4124;7.3951,51.3879?overview=false"); echo "$JSON" | grep -q '"distance"' && break; done
KM=$(echo "$JSON" | grep -o '"distance":[0-9.]*' | head -1 | sed 's/"distance"://'); [ -z "$KM" ] && KM=0
log "measured distance(m) = $KM"
if awk -v d="$KM" 'BEGIN{exit !(d>1000 && d<50000)}'; then
  log "OK -> switching backend to self-hosted"
  sed -i '/^NOMINATIM_URL=/d;/^OSRM_URL=/d' .env
  printf 'NOMINATIM_URL=http://nominatim:8080\nOSRM_URL=http://osrm:5000\n' >> .env
  $C up -d --force-recreate backend scheduler queue; sleep 20
  $C exec -T backend php artisan config:clear
  log "=== RESULT: SELF-HOSTED ACTIVE ($KM m) ==="
else
  log "=== RESULT: STAYED ON PUBLIC (bad distance: $KM) ==="
fi
log DONE
SCRIPT
chmod +x /root/ridy/osrm-build.sh
nohup /root/ridy/osrm-build.sh > /root/ridy/osrm-build.log 2>&1 &
echo "Building in background. When done: cat /root/ridy/osrm-build.log"
```

`osrm-extract` for Germany takes ~40–60 min (needs a few GB RAM). The volume is
`<project>_osrm_data` (usually `ridy_osrm_data`; confirm with `docker volume ls | grep osrm`).

---

## 3. Point the backend at the self-hosted services

Add these as GitHub Actions **secrets** (so every deploy keeps them):

```
NOMINATIM_URL = http://nominatim:8080
OSRM_URL      = http://osrm:5000
```

Then redeploy (push or re-run the last deploy). `config/services.php` reads these;
empty/unset falls back to the public services, so it is safe to set them only
after the import is verified.

Confirm the backend is using them:

```bash
docker compose -f docker-compose.prod.yml exec backend php artisan tinker --execute="dump(config('services.geo'));"
# Re-run distance backfill for offers that gave up on the public services:
docker compose -f docker-compose.prod.yml exec backend php artisan offers:backfill-geo --reset
```

New offers now geocode instantly against your own instance, with no rate limit.

---

## Keeping the map current (optional)

Nominatim's `REPLICATION_URL` is set to Geofabrik's Germany updates; enable
replication in the container to apply diffs, or periodically re-import. OSRM has
no live updates — re-run the step-2 prep against a fresh PBF when you want newer
roads, then restart the `osrm` service.

## Rollback

Unset `NOMINATIM_URL` / `OSRM_URL` (or clear the secrets) and redeploy — the
backend returns to the public services immediately. Stop the stack with
`docker compose -f docker-compose.prod.yml --profile geo down` (add `-v` to also
drop the imported volumes).
