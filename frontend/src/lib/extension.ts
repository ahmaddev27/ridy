// Thin bridge to the Reidey browser extension. The extension injects a content
// script (pair.js) that listens for window messages and relays them to its
// background worker, which can reach Uber from the manager's real browser IP.
//
// We talk to it purely via window.postMessage so the app stays decoupled from
// any extension API and degrades gracefully when the extension isn't installed.

// The extension version this dashboard build expects. Bump it in lockstep with
// extension/manifest.json. Store installs auto-update, so this only nudges
// managers on an older, manually-loaded build.
export const LATEST_EXTENSION_VERSION = "1.15.3";

// The published (unlisted) Chrome Web Store listing. Unlisted = installable by
// anyone with the link but hidden from search, so managers install with one
// "Add to Chrome" click and get automatic updates.
export const EXTENSION_ID = "jkejjdjgoknicbejmgcmojgdeljnaean";
export const EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;

/** True when `installed` is a valid version older than LATEST_EXTENSION_VERSION. */
export function isExtensionOutdated(installed: string | null | undefined): boolean {
  if (!installed) return false; // unknown version — don't nag
  return compareVersions(installed, LATEST_EXTENSION_VERSION) < 0;
}

/** Numeric semver-ish compare: returns <0, 0, or >0. Ignores pre-release tags. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface DriverMetrics {
  driver_uuid: string;
  period_start: number;
  period_end: number;
  earnings?: number | string | null;
  earnings_label?: string | null;
  trips?: number | string | null;
  hours_online?: number | string | null;
  hours_on_trip?: number | string | null;
  acceptance_rate?: number | string | null;
  cancellation_rate?: number | string | null;
}

/**
 * Ask the extension to pull one driver's Uber performance metrics for a window
 * (ms-epoch) via supplier GetEarnerMetrics, store them, and return them.
 * Resolves null when no extension answers.
 */
export function fetchDriverMetricsViaExtension(
  driverUuid: string,
  from: number,
  to: number,
  timeoutMs = 15000,
): Promise<DriverMetrics | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    function finish(result: DriverMetrics | null) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(result);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "ridy-metrics-done") return;
      finish(event.data.ok ? (event.data.metrics as DriverMetrics) : null);
    }
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "ridy-fetch-metrics", driverUuid, from, to }, "*");
  });
}

export interface VehicleSyncResult {
  ok: boolean;
  reason?: string;
  synced?: number;
}

/** Ask the extension to pull the fleet's vehicles from Uber and store them. */
export function fetchVehiclesViaExtension(timeoutMs = 20000): Promise<VehicleSyncResult | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    function finish(result: VehicleSyncResult | null) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(result);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "ridy-vehicles-done") return;
      const { source: _s, ...result } = event.data;
      finish(result as VehicleSyncResult);
    }
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "ridy-fetch-vehicles" }, "*");
  });
}

/** Ask the extension to refresh live online/offline presence for the drivers. */
export function fetchDriverStatusesViaExtension(
  driverUuids: string[],
  timeoutMs = 15000,
): Promise<{ ok: boolean; count?: number; reason?: string } | null> {
  if (typeof window === "undefined" || driverUuids.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    function finish(result: { ok: boolean } | null) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(result);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== "ridy-statuses-done") return;
      const { source: _s, ...result } = event.data;
      finish(result);
    }
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "ridy-fetch-statuses", driverUuids }, "*");
  });
}

export interface RosterSyncResult {
  ok: boolean;
  reason?: string;
  created?: number;
  updated?: number;
  matched?: number;
}

/**
 * Ask the extension to pull the driver roster from supplier.uber.com and post
 * it to the backend. Resolves with the extension's result, or `null` when no
 * extension answers within the timeout (so callers can fall back to the
 * server-side path).
 */
export function syncRosterViaExtension(timeoutMs = 15000): Promise<RosterSyncResult | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;

    function finish(result: RosterSyncResult | null) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (result === null) {
        console.warn("%c[Reidey roster]", "color:#b45309;font-weight:700", "no extension answered within timeout — falling back to server pull");
      } else {
        console.log("%c[Reidey roster]", "color:#059669;font-weight:700", "extension result:", result);
      }
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.source !== "ridy-roster-done") return;
      const { source: _source, ...result } = event.data;
      finish(result as RosterSyncResult);
    }

    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    console.log("%c[Reidey roster]", "color:#2563eb;font-weight:700", "requesting roster from the extension…");
    window.postMessage({ source: "ridy-sync-roster" }, "*");
  });
}
