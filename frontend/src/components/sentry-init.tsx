"use client";

import { useEffect } from "react";
import { scrubUrl } from "@/lib/sentry-scrub";

/**
 * Initializes Sentry (or a Sentry-compatible GlitchTip) on the client, once, and
 * only when a DSN is configured. No DSN → completely inert, and the SDK is not
 * even downloaded (dynamic import behind the DSN check). Avoids the Next build
 * plugin (source-map upload) so it can't break the build on a bleeding-edge Next;
 * this still captures unhandled errors + promise rejections at runtime.
 *
 * Secrets in URLs (the driver invite `token`, OTP/reset codes) are scrubbed from
 * events and breadcrumbs, and no default PII (IP, cookies) is attached.
 */
let started = false;
type SentryModule = typeof import("@sentry/react");
let sentryModule: Promise<SentryModule> | null = null;

function scrubMaybe(value: unknown): unknown {
  return typeof value === "string" ? scrubUrl(value) : value;
}

/** Report a caught error (e.g. from an error boundary) when Sentry is enabled. */
export function captureException(error: unknown): void {
  void sentryModule?.then((Sentry) => Sentry.captureException(error)).catch(() => {});
}

export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn || started) return;
    started = true;
    sentryModule = import("@sentry/react");
    sentryModule
      .then((Sentry) =>
        Sentry.init({
          dsn,
          environment: process.env.NODE_ENV,
          // Errors only — no performance tracing/replay, to stay light and free.
          tracesSampleRate: 0,
          sendDefaultPii: false,
          beforeSend(event) {
            if (event.request) {
              if (event.request.url) event.request.url = scrubUrl(event.request.url);
              if (typeof event.request.query_string === "string") {
                event.request.query_string = scrubUrl(event.request.query_string);
              }
              delete event.request.cookies;
            }
            return event;
          },
          beforeBreadcrumb(crumb) {
            if (crumb.data) {
              for (const key of ["url", "from", "to"]) {
                if (key in crumb.data) crumb.data[key] = scrubMaybe(crumb.data[key]);
              }
            }
            return crumb;
          },
        }),
      )
      .catch(() => {
        /* monitoring is best-effort */
      });
  }, []);

  return null;
}
