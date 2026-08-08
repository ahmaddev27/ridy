"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type AsyncOptions = {
  /** Poll the fetcher every N ms (silent — no skeleton flash). Off when unset. */
  refetchInterval?: number;
  /** Also refetch when the tab regains focus. Defaults to true when polling. */
  refetchOnFocus?: boolean;
};

/**
 * Runs an async fetcher on mount and exposes loading/error + refetch. With
 * `refetchInterval` it also polls silently in the background: the interval and
 * focus refetches keep the existing data on screen (no skeleton, no clearing on
 * a transient error), so the view updates in place — near real-time without a
 * manual refresh.
 */
export function useAsync<T>(fetcher: () => Promise<T>, options: AsyncOptions = {}) {
  const { refetchInterval, refetchOnFocus = refetchInterval != null } = options;

  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (silent = false) => {
    // A silent run (poll/focus) leaves the current data + loading flag alone so
    // the UI doesn't flicker; only the first/explicit load shows the skeleton.
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      // On a silent failure keep the last good data visible; only surface the
      // error on an explicit load so a blip doesn't blank the screen.
      setState((s) => (silent ? { ...s, error: message } : { data: null, loading: false, error: message }));
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  // Background polling.
  useEffect(() => {
    if (!refetchInterval) return;
    const id = setInterval(() => run(true), refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, run]);

  // Refetch when the tab regains focus / becomes visible again.
  useEffect(() => {
    if (!refetchOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") run(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetchOnFocus, run]);

  return { ...state, refetch: () => run(false) };
}
