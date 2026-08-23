import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';

// Load test: ramps to a steady concurrency, holds, then winds down. Exercises the
// marketing page plus a couple of read-only public API endpoints — the paths a
// real visitor and the dashboard's first paint hit. It never posts data.
//
//   k6 run load.js                         # defaults (peak 20 VUs)
//   k6 run -e BASE_URL=https://staging... -e PEAK=50 load.js
//
// Keep PEAK modest against production so real users are not disrupted; push hard
// only on staging.
const BASE = __ENV.BASE_URL || 'https://reidey.de';
const PEAK = Number(__ENV.PEAK || 20);

const pageLatency = new Trend('page_latency', true);
const apiLatency = new Trend('api_latency', true);

// 429 from the public API is the rate limiter working as intended, not a failure.
// Count it as an expected status so it doesn't inflate http_req_failed.
http.setResponseCallback(http.expectedStatuses(200, 429));

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: PEAK }, // ramp up
        { duration: '1m', target: PEAK },  // steady state
        { duration: '20s', target: 0 },    // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],        // < 1% errors
    page_latency: ['p(95)<800'],           // marketing page p95 < 800ms
    api_latency: ['p(95)<500'],            // read API p95 < 500ms
  },
};

export default function () {
  group('marketing', () => {
    const r = http.get(`${BASE}/`);
    pageLatency.add(r.timings.duration);
    check(r, { 'home 200': (res) => res.status === 200 });
  });

  group('public-api', () => {
    const r = http.get(`${BASE}/api/v1/plans`, {
      headers: { Accept: 'application/json' },
    });
    apiLatency.add(r.timings.duration);
    // 429 is a valid, healthy response (rate limiter doing its job).
    check(r, { 'plans 200/429': (res) => res.status === 200 || res.status === 429 });
  });

  sleep(1);
}
