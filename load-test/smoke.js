import http from 'k6/http';
import { check, sleep } from 'k6';

// Smoke test: 1 virtual user, ~30s. Confirms the site is up and the happy paths
// respond correctly before running anything heavier. Run first, always.
export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE = __ENV.BASE_URL || 'https://reidey.de';

// 429 from the rate-limited public API is expected, not a failure.
http.setResponseCallback(http.expectedStatuses(200, 429));

export default function () {
  const home = http.get(`${BASE}/`);
  check(home, {
    'home 200': (r) => r.status === 200,
    'home has html': (r) => (r.body || '').includes('<'),
  });

  // A public, cheap API endpoint (rate-limited, read-only).
  const plans = http.get(`${BASE}/api/v1/plans`, {
    headers: { Accept: 'application/json' },
  });
  check(plans, { 'plans 2xx/429': (r) => r.status === 200 || r.status === 429 });

  sleep(1);
}
