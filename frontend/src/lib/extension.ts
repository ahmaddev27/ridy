// Thin bridge to the Ridy browser extension. The extension injects a content
// script (pair.js) that listens for window messages and relays them to its
// background worker, which can reach Uber from the manager's real browser IP.
//
// We talk to it purely via window.postMessage so the app stays decoupled from
// any extension API and degrades gracefully when the extension isn't installed.

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
    window.postMessage({ source: "ridy-sync-roster" }, "*");
  });
}
