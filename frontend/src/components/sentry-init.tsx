"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/react";

/**
 * Initializes Sentry (or a Sentry-compatible GlitchTip) on the client, once, and
 * only when a DSN is configured. No DSN → completely inert. Avoids the Next build
 * plugin (source-map upload) so it can't break the build on a bleeding-edge Next;
 * this still captures unhandled errors + promise rejections at runtime.
 */
let started = false;

export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn || started) return;
    started = true;
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      // Errors only — no performance tracing/replay, to stay light and free.
      tracesSampleRate: 0,
    });
  }, []);

  return null;
}
