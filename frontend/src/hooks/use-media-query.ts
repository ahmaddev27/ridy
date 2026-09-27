"use client";

import { useSyncExternalStore } from "react";

/**
 * Live `window.matchMedia(query).matches`, for rendering ONE layout instead of
 * mounting a desktop and a mobile tree and hiding one with CSS. `serverDefault`
 * is used before hydration (and on the server).
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
