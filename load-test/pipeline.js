import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH PIPELINE LOAD TEST  —  STAGING / LOCAL ONLY, NEVER PRODUCTION.
//
// Drives the internal dispatch endpoints the way the Node daemon does: streams
// batches of Uber offers and driver status updates through the shared-secret
// ingest API. A matched offer exercises the whole hot path — DB write, geocode
// (Nominatim + OSRM), push notification (LogPushSender off-prod), and the async
// geocode queue job — so this measures the real end-to-end cost per offer.
//
// Prereqs (run once against the target DB):
//   php artisan loadtest:seed --drivers=50
//   (prints SESSION_ID; DRIVERS defaults to 50)
//
// Run:
//   k6 run -e SESSION_ID=<id> -e DRIVERS=50 \
//     -e SECRET=$DISPATCH_INGEST_SECRET -e BASE_URL=http://localhost pipeline.js
//
// Cleanup:
//   php artisan loadtest:teardown
// ─────────────────────────────────────────────────────────────────────────────

const BASE = __ENV.BASE_URL || 'http://localhost';
const SECRET = __ENV.SECRET || '';
const SESSION_ID = __ENV.SESSION_ID || '';
const DRIVERS = Number(__ENV.DRIVERS || 50);
const ORG = 'loadtest-org'; // must match LoadTestSeed::ORG_UUID
const OFFERS_PER_BATCH = Number(__ENV.OFFERS_PER_BATCH || 5);

const ingestLatency = new Trend('ingest_latency', true);
const statusLatency = new Trend('status_latency', true);
const offersRouted = new Counter('offers_routed');

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-Dispatch-Secret': SECRET,
};

export const options = {
  scenarios: {
    // The offer stream — the heavy path (store → geocode → push → queue).
    offers: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages: [
        { duration: '30s', target: 10 },  // 10 batches/s -> 50 offers/s
        { duration: '1m', target: 20 },   // sustain 20 batches/s -> 100 offers/s
        { duration: '20s', target: 0 },
      ],
      exec: 'ingestOffers',
    },
    // Driver presence updates that drive acceptance inference.
    statuses: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '1m50s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'ingestStatuses',
    },
  },
  thresholds: {
    ingest_latency: ['p(95)<1500'], // includes geocode; a cold address costs more
    status_latency: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// A pseudo-random driver index that varies per iteration without Math.random
// (which k6 allows, but keeping it deterministic-ish per VU/iter is cleaner).
function driverIdx() {
  return 1 + ((__VU * 7919 + __ITER * 104729) % DRIVERS);
}

function uniqueOfferUuid(i) {
  // Unique per (VU, iter, i) so offers are never deduped as repeats.
  return `lt-${__VU}-${__ITER}-${i}-${Date.now?.() ?? ''}`;
}

const PICKUPS = ['Hauptbahnhof, 80335 München', 'Alexanderplatz, 10178 Berlin', 'Dom, 50667 Köln'];
const DROPOFFS = ['Flughafen, 85356 München', 'Zoo, 10787 Berlin', 'Rheinauhafen, 50678 Köln'];

export function ingestOffers() {
  const offers = [];
  for (let i = 0; i < OFFERS_PER_BATCH; i++) {
    const d = driverIdx();
    offers.push({
      offerUUID: uniqueOfferUuid(i),
      partnerUUID: ORG,
      riderFirstName: 'Rider',
      driverInfo: { driverUUID: `loadtest-drv-${d}`, firstName: 'LoadTest', lastName: `D${d}` },
      pickupAddress: PICKUPS[d % PICKUPS.length],
      dropoffAddress: DROPOFFS[d % DROPOFFS.length],
      formattedUFP: '12,50 €',
      acceptWindowInSeconds: 5,
      requestAt: 0,
      offerGeneratedAtMs: 0,
    });
  }

  const res = http.post(`${BASE}/api/v1/internal/dispatch/ingest`,
    JSON.stringify({ offers, seq: __ITER }), { headers });

  ingestLatency.add(res.timings.duration);
  const ok = check(res, { 'ingest 200': (r) => r.status === 200 });
  if (ok) {
    try { offersRouted.add((res.json('data.routed') || 0)); } catch (_) { /* ignore */ }
  }
}

const STATUSES = ['EN_ROUTE', 'ON_TRIP', 'ONLINE', 'OFFLINE'];

export function ingestStatuses() {
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const d = driverIdx();
    statuses.push({
      driver_uuid: `loadtest-drv-${d}`,
      status: STATUSES[(d + __ITER) % STATUSES.length],
      location_updated_at: 0,
      latitude: 48.137 + d / 10000,
      longitude: 11.575 + d / 10000,
    });
  }

  const res = http.post(`${BASE}/api/v1/internal/dispatch/sessions/${SESSION_ID}/statuses`,
    JSON.stringify({ statuses }), { headers });

  statusLatency.add(res.timings.duration);
  check(res, { 'statuses 200': (r) => r.status === 200 });
}
