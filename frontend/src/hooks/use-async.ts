"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** Runs an async fetcher on mount and exposes loading/error + refetch. */
export function useAsync<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : "Something went wrong",
      });
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, refetch: run };
}
