# Load & performance testing

k6 scripts for probing reidey.de traffic capacity and latency. All scripts are
read-only (GET marketing page + public API) and never post data.

## Install k6

- **Debian/Ubuntu (server):**
  ```bash
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
    --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt update && sudo apt install k6
  ```
- **macOS:** `brew install k6`
- **Windows:** `winget install k6` (or `choco install k6`)

## Run

```bash
# 1. Smoke — always first. 1 user, ~30s, confirms the site is healthy.
k6 run smoke.js

# 2. Load — realistic ramp to steady concurrency (default peak 20 VUs).
k6 run load.js
k6 run -e PEAK=30 load.js                       # heavier
k6 run -e BASE_URL=https://staging.reidey.de -e PEAK=100 load.js

# 3. Stress — finds the breaking point. STAGING ONLY.
k6 run -e BASE_URL=https://staging.reidey.de stress.js
```

> Against **production**, keep `PEAK` modest (≤ 30) so real users aren't
> disrupted. Push hard only on staging or a throwaway environment.

## Reading the output

k6 prints per-metric summaries. Watch:

| Metric | Meaning | Healthy |
|---|---|---|
| `http_req_duration` p(95) | 95th-percentile latency | < 800ms page, < 500ms API |
| `http_req_failed` | error rate | < 1% |
| `iterations` / `http_reqs` | throughput (RPS) | higher is better |
| `vus` | concurrent virtual users | — |

A ✓ next to a threshold = passed; ✗ = the target bent under that load.

## Watch the server while a test runs

In a second terminal on the server:

```bash
docker stats                                                    # CPU/RAM per container
docker compose -f docker-compose.prod.yml exec mysql \
  mysqladmin -uroot -p processlist status                       # live DB queries
```

Enable the MySQL slow-query log to catch slow statements under load:

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5;
```

## Frontend performance

```bash
npx lighthouse https://reidey.de/ --only-categories=performance --view
```
Target a performance score > 90; watch LCP (< 2.5s) and CLS (< 0.1).
