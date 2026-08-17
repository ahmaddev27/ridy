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

OSRM needs a one-time preprocessing of the same PBF into a routing graph. Run the
three prep steps into the shared `osrm_data` volume, then the compose `osrm`
service serves it:

```bash
# Download the extract into the volume
docker run --rm -v ridy_osrm_data:/data osrm/osrm-backend:latest \
  sh -c "apk add --no-cache curl 2>/dev/null || true; \
         curl -L -o /data/germany-latest.osm.pbf https://download.geofabrik.de/europe/germany-latest.osm.pbf"

# Preprocess (MLD pipeline). extract is the slow one.
docker run --rm -v ridy_osrm_data:/data osrm/osrm-backend:latest \
  osrm-extract -p /opt/car.lua /data/germany-latest.osm.pbf
docker run --rm -v ridy_osrm_data:/data osrm/osrm-backend:latest \
  osrm-partition /data/germany-latest.osrm
docker run --rm -v ridy_osrm_data:/data osrm/osrm-backend:latest \
  osrm-customize /data/germany-latest.osrm

# Start the router (compose command already uses --algorithm mld)
docker compose -f docker-compose.prod.yml --profile geo up -d osrm
```

> The volume is named `<project>_osrm_data`; the project prefix is usually `ridy`
> (the repo dir). Confirm with `docker volume ls | grep osrm`.

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
