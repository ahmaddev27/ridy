import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { isLiveConnected, subscribeLive, type LiveEvent } from "./live";

type Options = {
  /** Poll interval while the realtime socket is down (or there is none). */
  fastMs: number;
  /** Poll interval while the socket is connected — it is only a safety net then. */
  slowMs: number;
  /** When false the screen neither polls nor listens (e.g. a finished offer). */
  enabled?: boolean;
  /** Ignore live events this screen doesn't care about (e.g. other offers). */
  accept?: (event: LiveEvent) => boolean;
};

/**
 * Keep a focused screen live without piling up requests:
 *  - loads on focus, then polls adaptively (slow while the socket is up),
 *  - reloads on every relevant live event (socket / push / resume),
 *  - single-flight: while a load runs, further triggers coalesce into ONE
 *    follow-up load with the latest inputs instead of parallel requests,
 *  - everything stops on blur and while the app is in the background.
 *
 * Returns `run`, the coalesced loader, for pull-to-refresh and input changes.
 */
export function useLiveReload(load: () => Promise<void>, { fastMs, slowMs, enabled = true, accept }: Options) {
  const loadRef = useRef(load);
  const acceptRef = useRef(accept);
  useEffect(() => {
    loadRef.current = load;
    acceptRef.current = accept;
  });

  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const run = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const task = (async () => {
      try {
        do {
          again.current = false;
          await loadRef.current().catch(() => {});
        } while (again.current);
      } finally {
        running.current = null;
      }
    })();
    running.current = task;
    return task;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const schedule = () => {
        timer = setTimeout(async () => {
          if (cancelled) return;
          if (AppState.currentState === "active") await run();
          if (!cancelled) schedule();
        }, isLiveConnected() ? slowMs : fastMs);
      };

      void run();
      schedule();
      const unsubscribe = subscribeLive((event) => {
        if (!acceptRef.current || acceptRef.current(event)) void run();
      });

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
      };
    }, [enabled, fastMs, slowMs, run]),
  );

  return run;
}

/**
 * Drop stale responses: call `begin()` before a request and apply its result
 * only if `isLatest(id)` still holds afterwards.
 */
export function useRequestSequence() {
  const seq = useRef(0);
  const begin = useCallback(() => ++seq.current, []);
  const isLatest = useCallback((id: number) => id === seq.current, []);
  return { begin, isLatest };
}
