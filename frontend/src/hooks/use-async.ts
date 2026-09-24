"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { localizedErrorMessage } from "@/lib/api/client";
import { usePolling } from "./use-polling";

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

type RefetchOptions = { silent?: boolean };

/**
 * Runs an async fetcher on mount and exposes loading/error + refetch. With
 * `refetchInterval` it also polls silently in the background: the interval and
 * focus refetches keep the existing data on screen (no skeleton, no clearing on
 * a transient error), so the view updates in place — near real-time without a
 * manual refresh. Polling pauses in hidden tabs, never overlaps an unfinished
 * request, and backs off after consecutive errors (see usePolling).
 *
 * Responses are sequenced: only the latest started request may write state, so
 * a slow poll that resolves after a post-mutation refetch can't roll the view
 * back to stale data.
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
  const hasDataRef = useRef(false);
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);

  const run = useCallback(async (silent = false): Promise<T | null> => {
    const my = ++seqRef.current;
    // A silent run (poll/focus) leaves the current data + loading flag alone so
    // the UI doesn't flicker; only the first/explicit load shows the skeleton.
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    inFlightRef.current++;
    try {
      const data = await fetcherRef.current();
      if (my === seqRef.current) {
        hasDataRef.current = true;
        setState({ data, loading: false, error: null });
      }
      return data; // let callers reuse the fresh data without a second fetch
    } catch (e) {
      if (my === seqRef.current) {
        const message = e instanceof Error && e.message ? e.message : localizedErrorMessage("generic");
        // On a silent failure keep the last good data visible; only surface the
        // error on an explicit load so a blip doesn't blank the screen.
        setState((s) => (silent ? { ...s, loading: false, error: message } : { data: null, loading: false, error: message }));
      }
      if (silent) throw e; // lets the poller back off
      return null;
    } finally {
      inFlightRef.current--;
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  // Background polling: never stack a poll on top of an unfinished request.
  const poll = useCallback(async () => {
    if (inFlightRef.current > 0) return;
    await run(true);
  }, [run]);

  usePolling(poll, refetchInterval ?? null, { refetchOnVisible: refetchOnFocus });

  // A refetch while data is already on screen is silent by default (keeps the
  // data, no skeleton flash); pass { silent: false } to force the visible reload
  // (e.g. a "retry" after an error). Callers sometimes hand refetch straight to
  // an event prop, so anything that isn't an options object is ignored.
  const refetch = useCallback(
    (opts?: RefetchOptions | unknown): Promise<T | null> => {
      const explicit =
        opts && typeof opts === "object" && "silent" in opts ? (opts as RefetchOptions).silent : undefined;
      const silent = explicit ?? hasDataRef.current;
      return silent ? run(true).catch(() => null) : run(false);
    },
    [run],
  );

  return { ...state, refetch };
}
