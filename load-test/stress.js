import http from 'k6/http';
import { check } from 'k6';

// Stress test: pushes concurrency up in steps until latency/errors degrade, to
// find the breaking point and the safe ceiling. STAGING ONLY — this deliberately
// overloads the target. Never run it against production.
//
//   k6 run -e BASE_URL=https://staging.reidey.de stress.js
const BASE = __ENV.BASE_URL || 'http://localhost';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 300 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // No hard fail — the point is to observe where it bends, not to pass/fail.
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  const r = http.get(`${BASE}/`);
  check(r, { 'status 200': (res) => res.status === 200 });
}
