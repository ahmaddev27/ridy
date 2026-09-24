"use client";

import { useEffect, useRef } from "react";

type PollingOptions = {
  /**
   * What to do while the tab is hidden: "pause" (default) skips ticks and runs
   * once as soon as the tab is visible again; a number polls at that slower
   * interval instead (for alerts that must keep sounding in a background tab).
   */
  whenHidden?: "pause" | number;
  /** Run immediately when the tab becomes visible / regains focus. Default true. */
  refetchOnVisible?: boolean;
  /** Upper bound for the error backoff. Default 5 minutes. */
  maxBackoffMs?: number;
};

// A tab switch fires both `focus` and `visibilitychange`; anything within this
// window of the previous run is the same wake-up and is ignored.
const WAKE_DEDUPE_MS = 2000;

/** Delay before the next tick: exponential backoff after consecutive failures. */
export function nextPollDelay(baseMs: number, consecutiveErrors: number, maxBackoffMs: number): number {
  if (consecutiveErrors <= 0) return baseMs;
  return Math.min(baseMs * 2 ** consecutiveErrors, Math.max(baseMs, maxBackoffMs));
}

/**
 * One polling policy for every background refresh on the dashboard: a chained
 * timeout (so a slow request never overlaps the next tick), paused while the tab
 * is hidden (browsers don't throttle fetches, only timers, and only late), with
 * exponential backoff on errors so polling eases off during an API incident
 * instead of piling on. `fn` should reject on failure for the backoff to apply.
 * `intervalMs` null/0 disables it. The latest `fn` is always used.
 */
export function usePolling(
  fn: () => Promise<unknown> | unknown,
  intervalMs: number | null | undefined,
  options: PollingOptions = {},
): void {
  const { whenHidden = "pause", refetchOnVisible = true, maxBackoffMs = 5 * 60_000 } = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!intervalMs) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let running = false;
    let errors = 0;
    let stale = false;
    let lastRun = Date.now(); // the owner does its own initial load

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const schedule = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      const base = isHidden() && typeof whenHidden === "number" ? whenHidden : intervalMs;
      timer = setTimeout(tick, nextPollDelay(base, errors, maxBackoffMs));
    };

    const execute = async () => {
      if (running) return;
      running = true;
      lastRun = Date.now();
      try {
        await fnRef.current();
        errors = 0;
      } catch {
        errors++;
      } finally {
        running = false;
      }
    };

    const tick = async () => {
      if (stopped) return;
      if (isHidden() && whenHidden === "pause") {
        stale = true;
        schedule();
        return;
      }
      await execute();
      schedule();
    };

    const onWake = () => {
      if (stopped || isHidden()) return;
      if (!refetchOnVisible && !stale) return;
      if (Date.now() - lastRun < WAKE_DEDUPE_MS) return;
      stale = false;
      void execute().then(schedule);
    };

    schedule();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [intervalMs, whenHidden, refetchOnVisible, maxBackoffMs]);
}
