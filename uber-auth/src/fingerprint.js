// Light, deterministic per-tenant variation so ~70 sessions are not byte-identical
// (docs/24 section 9.1). Seeded by the company key: the same tenant always gets the
// same window, so its fingerprint is stable across restarts.
const SIZES = [
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1600, 900],
  [1920, 1080],
];

function hash(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** @returns {{viewport:{width:number,height:number}, screen:{width:number,height:number}}} */
export function tenantScreen(key) {
  const [width, height] = SIZES[hash(key) % SIZES.length];
  return { viewport: { width, height: height - 88 }, screen: { width, height } };
}
